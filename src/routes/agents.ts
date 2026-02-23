// ═══════════════════════════════════════════
// VOUCH Agent & Rule Routes
// ═══════════════════════════════════════════

import { FastifyInstance } from 'fastify';
import { CreateAgentSchema, CreateRuleSchema } from '../utils/schemas';
import { requireJwt } from '../middleware/auth';
import { generateApiKey } from '../services/auth';
import { validateConditions } from '../services/rule-engine';
import { queryOne, query } from '../db';

export default async function agentRoutes(app: FastifyInstance) {

  // ─── POST /api/agents ──────────────────
  app.post('/api/agents', { preHandler: [requireJwt] }, async (req, reply) => {
    const parsed = CreateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0].message,
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }

    const user = (req as any).user;
    const { name, description } = parsed.data;

    // Limit agents per user (prevent abuse)
    const agentCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM agents WHERE user_id = $1 AND status = $2',
      [user.sub, 'active']
    );

    if (agentCount && parseInt(agentCount.count) >= 20) {
      return reply.code(400).send({
        error: 'Maximum 20 active agents per account',
        code: 'AGENT_LIMIT',
        status: 400,
      });
    }

    // Generate API key
    const { plaintext, hash, prefix } = generateApiKey();

    const agent = await queryOne<{ id: string; name: string; created_at: string }>(
      `INSERT INTO agents (user_id, name, description, api_key_prefix, api_key_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, created_at`,
      [user.sub, name, description || null, prefix, hash]
    );

    if (!agent) {
      return reply.code(500).send({ error: 'Failed to create agent', code: 'INTERNAL_ERROR', status: 500 });
    }

    return reply.code(201).send({
      agent_id: agent.id,
      name: agent.name,
      api_key: plaintext,  // ⚠️ Only time the full key is shown
      api_key_prefix: prefix,
      created_at: agent.created_at,
      warning: 'Save this API key now. It will not be shown again.',
    });
  });

  // ─── GET /api/agents ───────────────────
  app.get('/api/agents', { preHandler: [requireJwt] }, async (req, reply) => {
    const user = (req as any).user;

    const agents = await query<{
      id: string; name: string; description: string; api_key_prefix: string;
      status: string; proof_nonce: number; created_at: string;
    }>(
      `SELECT id, name, description, api_key_prefix, status, proof_nonce, created_at
       FROM agents WHERE user_id = $1 AND status != 'deleted'
       ORDER BY created_at DESC`,
      [user.sub]
    );

    return reply.code(200).send({ agents });
  });

  // ─── POST /api/agents/:id/rules ────────
  app.post('/api/agents/:id/rules', { preHandler: [requireJwt] }, async (req, reply) => {
    const parsed = CreateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0].message,
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }

    const user = (req as any).user;
    const agentId = (req.params as { id: string }).id;
    const { name, description, conditions } = parsed.data;

    // Verify agent belongs to user
    const agent = await queryOne<{ id: string }>(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2 AND status = $3',
      [agentId, user.sub, 'active']
    );

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found', code: 'AGENT_NOT_FOUND', status: 404 });
    }

    // Validate conditions
    const condCheck = validateConditions(conditions);
    if (!condCheck.valid) {
      return reply.code(400).send({
        error: condCheck.error,
        code: 'INVALID_CONDITIONS',
        status: 400,
      });
    }

    // Limit rules per agent
    const ruleCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM rules WHERE agent_id = $1 AND status = $2',
      [agentId, 'active']
    );

    if (ruleCount && parseInt(ruleCount.count) >= 50) {
      return reply.code(400).send({
        error: 'Maximum 50 active rules per agent',
        code: 'RULE_LIMIT',
        status: 400,
      });
    }

    const rule = await queryOne<{ id: string; name: string; version: number; created_at: string }>(
      `INSERT INTO rules (agent_id, name, description, conditions)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, version, created_at`,
      [agentId, name, description || null, JSON.stringify(conditions)]
    );

    if (!rule) {
      return reply.code(500).send({ error: 'Failed to create rule', code: 'INTERNAL_ERROR', status: 500 });
    }

    return reply.code(201).send({
      rule_id: rule.id,
      agent_id: agentId,
      name: rule.name,
      conditions,
      version: rule.version,
      created_at: rule.created_at,
    });
  });

  // ─── GET /api/agents/:id/rules ─────────
  app.get('/api/agents/:id/rules', { preHandler: [requireJwt] }, async (req, reply) => {
    const user = (req as any).user;
    const agentId = (req.params as { id: string }).id;

    // Verify agent belongs to user
    const agent = await queryOne('SELECT id FROM agents WHERE id = $1 AND user_id = $2', [agentId, user.sub]);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found', code: 'AGENT_NOT_FOUND', status: 404 });
    }

    const rules = await query<{
      id: string; name: string; description: string; conditions: any;
      version: number; status: string; created_at: string;
    }>(
      `SELECT id, name, description, conditions, version, status, created_at
       FROM rules WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    );

    return reply.code(200).send({ rules });
  });
}
