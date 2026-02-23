// ═══════════════════════════════════════════
// VOUCH Dashboard & Pricing Routes
// ═══════════════════════════════════════════

import { FastifyInstance } from 'fastify';
import { ProofsQuerySchema, PricingEstimateSchema } from '../utils/schemas';
import { requireApiKey } from '../middleware/auth';
import { queryOne, query } from '../db';
import { estimateBill, TIERS } from '../utils/tiers';

export default async function dashboardRoutes(app: FastifyInstance) {

  // ─── GET /api/dashboard/stats ──────────
  app.get('/api/dashboard/stats', { preHandler: [requireApiKey] }, async (req, reply) => {
    const user = (req as any).user;

    // Active agents count
    const agentCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM agents WHERE user_id = $1 AND status = $2',
      [user.id, 'active']
    );

    // Active rules count
    const ruleCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM rules r
       JOIN agents a ON r.agent_id = a.id
       WHERE a.user_id = $1 AND r.status = 'active'`,
      [user.id]
    );

    // Proofs on chain
    const onChainCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM proofs p
       JOIN agents a ON p.agent_id = a.id
       WHERE a.user_id = $1 AND p.on_chain_tx_hash IS NOT NULL`,
      [user.id]
    );

    // Pass rate
    const passRate = await queryOne<{ total: string; passed: string }>(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE p.rule_met = true) as passed
       FROM proofs p
       JOIN agents a ON p.agent_id = a.id
       WHERE a.user_id = $1`,
      [user.id]
    );

    const total = parseInt(passRate?.total || '0');
    const passed = parseInt(passRate?.passed || '0');
    const rate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;

    const tier = TIERS[user.tier];
    const costThisMonth = user.used_proofs_this_month * (tier ? tier.base_fee / Math.max(tier.monthly_limit, 1) : 0);

    return reply.code(200).send({
      tier: user.tier,
      monthly_limit: user.monthly_proofs_limit,
      used_this_month: user.used_proofs_this_month,
      remaining: Math.max(0, user.monthly_proofs_limit - user.used_proofs_this_month),
      proofs_on_chain: parseInt(onChainCount?.count || '0'),
      cost_this_month: `$${costThisMonth.toFixed(2)}`,
      agents_active: parseInt(agentCount?.count || '0'),
      rules_active: parseInt(ruleCount?.count || '0'),
      pass_rate: rate,
    });
  });

  // ─── GET /api/dashboard/proofs ─────────
  app.get('/api/dashboard/proofs', { preHandler: [requireApiKey] }, async (req, reply) => {
    const parsed = ProofsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query params', code: 'VALIDATION_ERROR', status: 400 });
    }

    const { page, limit, rule_met, agent_id } = parsed.data;
    const user = (req as any).user;
    const offset = (page - 1) * limit;

    // Build query dynamically
    let where = 'a.user_id = $1';
    const params: any[] = [user.id];
    let paramIndex = 2;

    if (rule_met !== undefined) {
      where += ` AND p.rule_met = $${paramIndex}`;
      params.push(rule_met === 'true');
      paramIndex++;
    }

    if (agent_id) {
      where += ` AND p.agent_id = $${paramIndex}`;
      params.push(agent_id);
      paramIndex++;
    }

    // Count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM proofs p
       JOIN agents a ON p.agent_id = a.id
       WHERE ${where}`,
      params
    );
    const total = parseInt(countResult?.count || '0');

    // Fetch page
    const proofs = await query(
      `SELECT p.id as proof_id, p.proof_hash, a.name as agent_name,
              r.name as rule_name, p.rule_met, p.decision_summary,
              p.proof_cost, p.on_chain_tx_hash, p.created_at
       FROM proofs p
       JOIN agents a ON p.agent_id = a.id
       JOIN rules r ON p.rule_id = r.id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return reply.code(200).send({
      total,
      page,
      limit,
      proofs,
    });
  });

  // ─── GET /api/pricing/estimate ─────────
  app.get('/api/pricing/estimate', async (req, reply) => {
    const parsed = PricingEstimateSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query params', code: 'VALIDATION_ERROR', status: 400 });
    }

    const { tier, monthly_proofs } = parsed.data;
    const estimate = estimateBill(tier, monthly_proofs);

    return reply.code(200).send({
      tier,
      ...estimate,
      features: TIERS[tier]?.features || [],
    });
  });
}
