// ═══════════════════════════════════════════
// VOUCH Auth Service
// bcrypt passwords, RS256 JWT, SHA-256 API keys
// ═══════════════════════════════════════════

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = '24h';
const API_KEY_PREFIX = 'sk_live_';

// ─── Password Hashing ────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT (RS256 or HS256 fallback) ───────

function getJwtSecret(): { key: string; algorithm: jwt.Algorithm } {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  if (privateKey && privateKey.includes('BEGIN')) {
    // RS256 with PEM key
    return { key: privateKey.replace(/\\n/g, '\n'), algorithm: 'RS256' };
  }

  // Fallback to HS256 with a secret string (dev mode)
  const secret = process.env.JWT_SECRET || 'vouch-dev-secret-change-in-production';
  if (process.env.NODE_ENV === 'production' && !privateKey) {
    throw new Error('JWT_PRIVATE_KEY must be set in production');
  }
  return { key: secret, algorithm: 'HS256' };
}

function getJwtVerifyKey(): { key: string; algorithms: jwt.Algorithm[] } {
  const publicKey = process.env.JWT_PUBLIC_KEY;
  if (publicKey && publicKey.includes('BEGIN')) {
    return { key: publicKey.replace(/\\n/g, '\n'), algorithms: ['RS256'] };
  }

  const secret = process.env.JWT_SECRET || 'vouch-dev-secret-change-in-production';
  return { key: secret, algorithms: ['HS256'] };
}

export interface JwtPayload {
  sub: string;   // user ID
  email: string;
  tier: string;
}

export function signJwt(payload: JwtPayload): string {
  const { key, algorithm } = getJwtSecret();
  return jwt.sign(payload, key, {
    algorithm,
    expiresIn: JWT_EXPIRY,
    issuer: 'vouch',
  });
}

export function verifyJwt(token: string): JwtPayload {
  const { key, algorithms } = getJwtVerifyKey();
  const decoded = jwt.verify(token, key, {
    algorithms,
    issuer: 'vouch',
  });
  return decoded as JwtPayload;
}

// ─── API Keys ────────────────────────────

/**
 * Generate a new API key.
 * Returns the plaintext key (shown once) and its SHA-256 hash (stored).
 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString('hex');
  const plaintext = API_KEY_PREFIX + random;
  const hash = hashApiKey(plaintext);
  const prefix = API_KEY_PREFIX + random.slice(0, 4) + '...';

  return { plaintext, hash, prefix };
}

/**
 * Hash an API key with SHA-256 for storage.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
