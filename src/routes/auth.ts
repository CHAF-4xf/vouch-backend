// ═══════════════════════════════════════════
// VOUCH Auth Routes — BULLETPROOF VERSION
// Verbose logging so we can see exactly what fails
// ═══════════════════════════════════════════

import { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword, signJwt } from '../services/auth';
import { queryOne } from '../db';

export default async function authRoutes(app: FastifyInstance) {

  // ─── POST /api/auth/signup ─────────────
  app.post('/api/auth/signup', async (req, reply) => {
    try {
      const body = req.body as any;
      console.log('[signup] Request received:', { email: body?.email });

      // Basic validation
      if (!body || !body.email || !body.password) {
        return reply.code(400).send({
          error: 'Email and password are required',
          code: 'VALIDATION_ERROR',
          status: 400,
        });
      }

      const email = String(body.email).toLowerCase().trim();
      const password = String(body.password);

      if (password.length < 12) {
        return reply.code(422).send({
          error: 'Password must be at least 12 characters',
          code: 'VALIDATION_ERROR',
          status: 422,
        });
      }

      // Check if email exists
      console.log('[signup] Checking if email exists...');
      const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) {
        console.log('[signup] Email already exists');
        return reply.code(409).send({
          error: 'An account with this email already exists',
          code: 'EMAIL_EXISTS',
          status: 409,
        });
      }

      // Hash password
      console.log('[signup] Hashing password...');
      const passwordHash = await hashPassword(password);
      console.log('[signup] Password hashed successfully');

      // Create user
      console.log('[signup] Inserting user...');
      const user = await queryOne<{ id: string; email: string; tier: string; monthly_proofs_limit: number }>(
        `INSERT INTO users (email, password_hash, tier, monthly_proofs_limit)
         VALUES ($1, $2, 'free', 10)
         RETURNING id, email, tier, monthly_proofs_limit`,
        [email, passwordHash]
      );

      if (!user) {
        console.error('[signup] User insert returned null');
        return reply.code(500).send({ error: 'Failed to create account', code: 'INTERNAL_ERROR', status: 500 });
      }
      console.log('[signup] User created:', user.id);

      // Issue JWT
      console.log('[signup] Signing JWT...');
      const token = signJwt({ sub: user.id, email: user.email, tier: user.tier });
      console.log('[signup] JWT signed successfully');

      return reply.code(201).send({
        user_id: user.id,
        email: user.email,
        tier: user.tier,
        monthly_proofs_limit: user.monthly_proofs_limit,
        token,
      });

    } catch (err: any) {
      console.error('[signup] FATAL ERROR:', err.message);
      console.error('[signup] Stack:', err.stack);
      return reply.code(500).send({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500,
      });
    }
  });

  // ─── POST /api/auth/login ──────────────
  app.post('/api/auth/login', async (req, reply) => {
    try {
      const body = req.body as any;

      if (!body || !body.email || !body.password) {
        return reply.code(400).send({ error: 'Email and password are required', code: 'VALIDATION_ERROR', status: 400 });
      }

      const email = String(body.email).toLowerCase().trim();
      const password = String(body.password);

      const user = await queryOne<{
        id: string; email: string; password_hash: string; tier: string;
      }>(
        'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
        [email]
      );

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

    } catch (err: any) {
      console.error('[login] FATAL ERROR:', err.message);
      console.error('[login] Stack:', err.stack);
      return reply.code(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500 });
    }
  });
}
