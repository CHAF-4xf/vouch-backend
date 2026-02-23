// ═══════════════════════════════════════════
// VOUCH Auth Middleware
// Two modes: JWT (dashboard) and API key (prove)
// ═══════════════════════════════════════════

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt, hashApiKey } from '../services/auth';
import { queryOne } from '../db';

// ─── JWT Auth (for dashboard, agent/rule management) ─────

export async function requireJwt(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header', code: 'AUTH_MISSING' });
  }

  try {
    const token = auth.slice(7);
    const payload = verifyJwt(token);

    // Attach user to request
    (req as any).user = payload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return reply.code(401).send({ error: 'Token expired', code: 'AUTH_EXPIRED' });
    }
    return reply.code(401).send({ error: 'Invalid token', code: 'AUTH_INVALID' });
  }
}

// ─── API Key Auth (for /prove and /dashboard endpoints) ──

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing API key', code: 'AUTH_MISSING' });
  }

  const apiKey = auth.slice(7);

  // Must start with sk_live_
  if (!apiKey.startsWith('sk_live_')) {
    return reply.code(401).send({ error: 'Invalid API key format', code: 'AUTH_INVALID_KEY' });
  }

  const keyHash = hashApiKey(apiKey);

  const agent = await queryOne<{
    id: string;
    user_id: string;
    name: string;
    status: string;
    proof_nonce: number;
  }>(
    `SELECT a.id, a.user_id, a.name, a.status, a.proof_nonce
     FROM agents a
     WHERE a.api_key_hash = $1`,
    [keyHash]
  );

  if (!agent) {
    return reply.code(401).send({ error: 'Invalid API key', code: 'AUTH_INVALID_KEY' });
  }

  if (agent.status !== 'active') {
    return reply.code(403).send({ error: 'Agent is suspended', code: 'AGENT_SUSPENDED' });
  }

  // Get user info for quota checks
  const user = await queryOne<{
    id: string;
    email: string;
    tier: string;
    monthly_proofs_limit: number;
    used_proofs_this_month: number;
  }>(
    `SELECT id, email, tier, monthly_proofs_limit, used_proofs_this_month
     FROM users WHERE id = $1`,
    [agent.user_id]
  );

  if (!user) {
    return reply.code(401).send({ error: 'Invalid API key', code: 'AUTH_INVALID_KEY' });
  }

  // Attach both to request
  (req as any).agent = agent;
  (req as any).user = user;
}
