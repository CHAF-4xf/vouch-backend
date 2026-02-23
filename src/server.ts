// ═══════════════════════════════════════════
// VOUCH Backend Server
// ═══════════════════════════════════════════

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { dbHealthCheck } from './db';
import { loadSigningKey, loadEncryptionKey } from './services/proof-generator';
import { errorHandler } from './middleware/error-handler';

import authRoutes from './routes/auth';
import proveRoutes from './routes/prove';
import agentRoutes from './routes/agents';
import dashboardRoutes from './routes/dashboard';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,  // Railway runs behind a proxy
  });

  // ─── Plugins ─────────────────────────────

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,  // API only, no HTML
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,                      // default global limit
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Use API key hash if present, otherwise IP
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer sk_live_')) {
        return 'key:' + auth.slice(7, 27);  // first 20 chars as key
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
