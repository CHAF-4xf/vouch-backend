// ═══════════════════════════════════════════
// VOUCH Auth Service — BULLETPROOF VERSION
// bcryptjs (pure JS, no native deps), JWT HS256, SHA-256 API keys
// ═══════════════════════════════════════════

import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = '24h';
const API_KEY_PREFIX = 'sk_live_';

// ─── Password Hashing (pure JS bcryptjs) ──

let bcryptjs: any = null;

async function getBcrypt() {
  if (!bcryptjs) {
    try {
      bcryptjs = require('bcryptjs');
    } catch {
      try {
        bcryptjs = require('bcrypt');
      } catch {
        throw new Error('Neither bcryptjs nor bcrypt is installed');
      }
    }
  }
  return bcryptjs;
}

export async function hashPassword(password: string): Promise<string> {
  const bc = await getBcrypt();
  return bc.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bc = await getBcrypt();
  return bc.compare(password, hash);
}

// ─── JWT (HS256 — simple and reliable) ────

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.JWT_PRIVATE_KEY || 'vouch-dev-secret-change-in-production';
  if (process.env.NODE_ENV === 'production' && secret === 'vouch-dev-secret-change-in-production') {
    console.warn('[auth] WARNING: Using default JWT secret in production. Set JWT_SECRET env var.');
  }
  return secret;
}

export interface JwtPayload {
  sub: string;
  email: string;
  tier: string;
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRY,
    issuer: 'vouch',
  });
}

export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'vouch',
  });
  return decoded as JwtPayload;
}

// ─── API Keys ────────────────────────────

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString('hex');
  const plaintext = API_KEY_PREFIX + random;
  const hash = hashApiKey(plaintext);
  const prefix = API_KEY_PREFIX + random.slice(0, 4) + '...';
  return { plaintext, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
