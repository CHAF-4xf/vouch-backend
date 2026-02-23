// ═══════════════════════════════════════════
// VOUCH Auth Routes — /api/auth
// ═══════════════════════════════════════════

import { FastifyInstance } from 'fastify';
import { SignupSchema, LoginSchema } from '../utils/schemas';
import { hashPassword, verifyPassword, signJwt } from '../services/auth';
import { queryOne, query } from '../db';
import { TIERS } from '../utils/tiers';

export default async function authRoutes(app: FastifyInstance) {

  // ─── POST /api/auth/signup ─────────────
  app.post('/api/auth/signup', async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: parsed.error.issues[0].message,
        code: 'VALIDATION_ERROR',
        status: 422,
      });
    }

    const { email, password } = parsed.data;

    // Check if email exists
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) {
      return reply.code(409).send({
        error: 'An account with this email already exists',
        code: 'EMAIL_EXISTS',
        status: 409,
      });
    }

    // Hash password + create user
    const passwordHash = await hashPassword(password);
    const tier = TIERS.free;

    const user = await queryOne<{ id: string; email: string; tier: string; monthly_proofs_limit: number }>(
      `INSERT INTO users (email, password_hash, tier, monthly_proofs_limit)
       VALUES ($1, $2, 'free', $3)
       RETURNING id, email, tier, monthly_proofs_limit`,
      [email.toLowerCase(), passwordHash, tier.monthly_limit]
    );

    if (!user) {
      return reply.code(500).send({ error: 'Failed to create account', code: 'INTERNAL_ERROR', status: 500 });
    }

    // Issue JWT
    const token = signJwt({ sub: user.id, email: user.email, tier: user.tier });

    return reply.code(201).send({
      user_id: user.id,
      email: user.email,
      tier: user.tier,
      monthly_proofs_limit: user.monthly_proofs_limit,
      token,
    });
  });

  // ─── POST /api/auth/login ──────────────
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', code: 'VALIDATION_ERROR', status: 400 });
    }

    const { email, password } = parsed.data;

    const user = await queryOne<{
      id: string; email: string; password_hash: string; tier: string;
    }>(
      'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Same error for wrong email or wrong password (prevents enumeration)
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'AUTH_INVALID', status: 401 });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'AUTH_INVALID', status: 401 });
    }

    const token = signJwt({ sub: user.id, email: user.email, tier: user.tier });

    return reply.code(200).send({
      token,
      expires_in: 86400,
      tier: user.tier,
    });
  });
}
