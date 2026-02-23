// ═══════════════════════════════════════════
// VOUCH Prove Routes — /api/prove
// The core value: evaluate rule → generate proof
// ═══════════════════════════════════════════

import { FastifyInstance } from 'fastify';
import { ProveSchema } from '../utils/schemas';
import { requireApiKey } from '../middleware/auth';
import { evaluateRule, validateConditions } from '../services/rule-engine';
import { generateProof } from '../services/proof-generator';
import { queryOne, query, transaction } from '../db';
import { TIERS } from '../utils/tiers';

export default async function proveRoutes(app: FastifyInstance) {

  // ─── POST /api/prove ⭐ Core Endpoint ──
  app.post('/api/prove', { preHandler: [requireApiKey] }, async (req, reply) => {
    const parsed = ProveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0].message,
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }

    const { rule_id, action_data } = parsed.data;
    const agent = (req as any).agent;
    const user = (req as any).user;

    // 1. Check proof quota
    const tier = TIERS[user.tier];
    if (!tier) {
      return reply.code(500).send({ error: 'Invalid tier', code: 'INTERNAL_ERROR', status: 500 });
    }

    if (user.tier === 'free' && user.used_proofs_this_month >= tier.monthly_limit) {
      return reply.code(402).send({
        error: 'Free tier proof limit reached. Upgrade to continue.',
        code: 'QUOTA_EXCEEDED',
        status: 402,
        limit: tier.monthly_limit,
        used: user.used_proofs_this_month,
      });
    }

    // 2. Find the rule (must belong to this agent)
    const rule = await queryOne<{
      id: string; agent_id: string; conditions: any; status: string; name: string;
    }>(
      'SELECT id, agent_id, conditions, status, name FROM rules WHERE id = $1',
      [rule_id]
    );

    if (!rule) {
      return reply.code(404).send({ error: 'Rule not found', code: 'RULE_NOT_FOUND', status: 404 });
    }

    if (rule.agent_id !== agent.id) {
      return reply.code(403).send({ error: 'Rule does not belong to this agent', code: 'RULE_MISMATCH', status: 403 });
    }

    if (rule.status !== 'active') {
      return reply.code(403).send({ error: 'Rule is archived', code: 'RULE_ARCHIVED', status: 403 });
    }

    // 3. Validate conditions are still well-formed
    const condCheck = validateConditions(rule.conditions);
    if (!condCheck.valid) {
      return reply.code(500).send({ error: 'Rule conditions corrupted', code: 'RULE_CORRUPT', status: 500 });
    }

    // 4. ⭐ EVALUATE — this is the core value prop
    const ruleEval = evaluateRule(rule.conditions, action_data);

    // 5. Generate cryptographic proof (hash → sign → encrypt)
    const proof = await transaction(async (client) => {
      // Atomic nonce increment
      const nonceResult = await client.query(
        'UPDATE agents SET proof_nonce = proof_nonce + 1 WHERE id = $1 RETURNING proof_nonce',
        [agent.id]
      );
      const nonce = nonceResult.rows[0].proof_nonce;

      // Generate proof
      const generated = generateProof(
        agent.id,
        rule.id,
        rule.conditions,
        action_data,
        ruleEval.evaluation,
        ruleEval.rule_met,
        nonce
      );

      // Calculate cost
      const costPerProof = user.tier === 'free' ? 0 : (TIERS[user.tier]?.base_fee || 9.99) / (TIERS[user.tier]?.monthly_limit || 1000);

      // Store proof
      const proofRecord = await client.query(
        `INSERT INTO proofs (agent_id, rule_id, action_data, evaluation, rule_met, decision_summary,
          proof_hash, signature_encrypted, nonce, proof_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, proof_hash, rule_met, decision_summary, proof_cost, created_at`,
        [
          agent.id, rule.id,
          JSON.stringify(action_data),
          JSON.stringify(ruleEval.evaluation),
          ruleEval.rule_met,
          ruleEval.summary,
          generated.proof_hash,
          generated.signature_encrypted,
          nonce,
          costPerProof
        ]
      );

      // Increment user proof counter
      await client.query(
        'UPDATE users SET used_proofs_this_month = used_proofs_this_month + 1 WHERE id = $1',
        [user.id]
      );

      return proofRecord.rows[0];
    });

    // 6. Return proof
    return reply.code(201).send({
      proof_id: proof.id,
      proof_hash: proof.proof_hash,
      rule_met: proof.rule_met,
      evaluation: ruleEval.evaluation,
      summary: proof.decision_summary,
      cost: `$${Number(proof.proof_cost).toFixed(4)}`,
      on_chain: false,
      verify_url: `https://getvouched.ai/proof/${proof.id}`,
      created_at: proof.created_at,
    });
  });

  // ─── GET /api/prove/:id (Public) ───────
  app.get('/api/prove/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    // Basic UUID format check
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.code(400).send({ error: 'Invalid proof ID format', code: 'INVALID_ID', status: 400 });
    }

    const proof = await queryOne<{
      id: string; proof_hash: string; rule_met: boolean; evaluation: any;
      decision_summary: string; on_chain_tx_hash: string | null; created_at: string;
    }>(
      `SELECT id, proof_hash, rule_met, evaluation, decision_summary,
              on_chain_tx_hash, created_at
       FROM proofs WHERE id = $1`,
      [id]
    );

    if (!proof) {
      return reply.code(404).send({ error: 'Proof not found', code: 'PROOF_NOT_FOUND', status: 404 });
    }

    return reply.code(200).send({
      proof_id: proof.id,
      proof_hash: proof.proof_hash,
      rule_met: proof.rule_met,
      evaluation: proof.evaluation,
      summary: proof.decision_summary,
      on_chain: !!proof.on_chain_tx_hash,
      on_chain_tx: proof.on_chain_tx_hash,
      created_at: proof.created_at,
    });
  });
}
