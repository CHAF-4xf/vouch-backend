// ═══════════════════════════════════════════
// VOUCH Backend Server
// ═══════════════════════════════════════════

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { query, dbHealthCheck } from './db';
import { loadSigningKey, loadEncryptionKey } from './services/proof-generator';
import { errorHandler } from './middleware/error-handler';

import authRoutes from './routes/auth';
import proveRoutes from './routes/prove';
import agentRoutes from './routes/agents';
import dashboardRoutes from './routes/dashboard';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

// ─── Auto-Migration ──────────────────────
// Runs on every startup. Safe to re-run (all CREATE IF NOT EXISTS).

async function autoMigrate() {
  console.log('[migrate] Running auto-migration...');

  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      tier VARCHAR(50) DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'growth', 'enterprise')),
      monthly_proofs_limit INT DEFAULT 10,
      used_proofs_this_month INT DEFAULT 0,
      billing_cycle_start DATE DEFAULT CURRENT_DATE,
      stripe_customer_id VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      api_key_prefix VARCHAR(16) NOT NULL,
      api_key_hash VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
      proof_nonce INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      conditions JSONB NOT NULL,
      version INT DEFAULT 1,
      status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_rules_agent_id ON rules(agent_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS proofs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id),
      rule_id UUID NOT NULL REFERENCES rules(id),
      action_data JSONB NOT NULL,
      evaluation JSONB NOT NULL,
      rule_met BOOLEAN NOT NULL,
      decision_summary VARCHAR(255),
      proof_hash VARCHAR(66) NOT NULL UNIQUE,
      signature_encrypted TEXT NOT NULL,
      nonce INT NOT NULL,
      on_chain_tx_hash VARCHAR(66),
      on_chain_batch_id UUID,
      proof_cost DECIMAL(10, 6) DEFAULT 0.009900,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_proofs_agent_id ON proofs(agent_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_proofs_rule_id ON proofs(rule_id)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proofs_hash ON proofs(proof_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_proofs_created ON proofs(created_at DESC)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rules_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id UUID NOT NULL REFERENCES rules(id),
      version INT NOT NULL,
      conditions JSONB NOT NULL,
      changed_by UUID REFERENCES users(id),
      change_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_rules_history_rule ON rules_history(rule_id, version)`);

  await query(`
    CREATE TABLE IF NOT EXISTS billing (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      billing_month DATE NOT NULL,
      proofs_generated INT DEFAULT 0,
      proofs_on_chain INT DEFAULT 0,
      base_monthly DECIMAL(10, 2),
      overage_proofs INT DEFAULT 0,
      overage_cost DECIMAL(10, 2) DEFAULT 0,
      total_charged DECIMAL(10, 2),
      payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'waived')),
      stripe_invoice_id VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, billing_month)
    )
  `);

  // Trigger function for updated_at
  await query(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql
  `);

  // Create triggers (DROP first to avoid "already exists" errors on re-run)
  const triggers = [
    { name: 'users_updated_at', table: 'users' },
    { name: 'agents_updated_at', table: 'agents' },
    { name: 'rules_updated_at', table: 'rules' },
    { name: 'billing_updated_at', table: 'billing' },
  ];

  for (const t of triggers) {
    await query(`DROP TRIGGER IF EXISTS ${t.name} ON ${t.table}`);
    await query(`CREATE TRIGGER ${t.name} BEFORE UPDATE ON ${t.table} FOR EACH ROW EXECUTE FUNCTION update_updated_at()`);
  }

  console.log('[migrate] ✓ All 6 tables ready.');
}

// ─── Server ──────────────────────────────

async function start() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
  });

  // ─── Auto-Migrate on Startup ────────────

  try {
    await autoMigrate();
    app.log.info('Database migration complete');
  } catch (err: any) {
    app.log.error(`Migration failed: ${err.message}`);
    // Don't exit — let health check report degraded
  }

  // ─── Plugins ─────────────────────────────

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer sk_live_')) {
        return 'key:' + auth.slice(7, 27);
      }
      return 'ip:' + req.ip;
    },
  });

  // ─── Error Handler ───────────────────────

  app.setErrorHandler(errorHandler);

  // ─── Health Check ────────────────────────

  app.get('/health', async (req, reply) => {
    const dbOk = await dbHealthCheck();
    const status = dbOk ? 'ok' : 'degraded';

    return reply.code(dbOk ? 200 : 503).send({
      status,
      version: '1.0.0',
      db: dbOk ? 'connected' : 'disconnected',
      uptime: Math.floor(process.uptime()),
    });
  });

  // ─── Routes ──────────────────────────────

  await app.register(authRoutes);
  await app.register(proveRoutes);
  await app.register(agentRoutes);
  await app.register(dashboardRoutes);

  // ─── Load Crypto Keys ────────────────────

  try {
    loadSigningKey();
    app.log.info('ECDSA signing key loaded');
  } catch (err: any) {
    app.log.warn(`ECDSA key not loaded: ${err.message}. Proof generation will fail.`);
  }

  try {
    loadEncryptionKey();
    app.log.info('AES encryption key loaded');
  } catch (err: any) {
    app.log.warn(`Encryption key not loaded: ${err.message}. Proof generation will fail.`);
  }

  // ─── Start ───────────────────────────────

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`VOUCH API running on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
