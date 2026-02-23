// ═══════════════════════════════════════════
// VOUCH Proof Generator
// Keccak256 hash → ECDSA sign → AES-256-GCM encrypt
// ═══════════════════════════════════════════

import { keccak256 } from 'ethereum-cryptography/keccak';
import { secp256k1 } from 'ethereum-cryptography/secp256k1';
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { Condition, EvalResult } from './rule-engine';

// ─── Proof Payload ───────────────────────

interface ProofPayload {
  v: number;           // format version
  agent: string;       // agent ID
  rule: string;        // rule ID
  conditions: Condition[];
  action: Record<string, any>;
  eval: EvalResult[];
  met: boolean;
  nonce: number;
  ts: number;          // unix timestamp
}

/**
 * Build a deterministic proof payload.
 * Sorted keys ensure same inputs always produce same hash.
 */
export function buildProofPayload(
  agentId: string,
  ruleId: string,
  conditions: Condition[],
  actionData: Record<string, any>,
  evaluation: EvalResult[],
  ruleMet: boolean,
  nonce: number
): string {
  const payload: ProofPayload = {
    v: 1,
    agent: agentId,
    rule: ruleId,
    conditions,
    action: actionData,
    eval: evaluation,
    met: ruleMet,
    nonce,
    ts: Math.floor(Date.now() / 1000)
  };

  // Deterministic serialization: sorted keys
  return JSON.stringify(payload, Object.keys(payload).sort());
}

// ─── Keccak256 Hash ──────────────────────

/**
 * Hash a normalized payload string with Keccak256.
 * Returns 0x-prefixed 64-char hex string.
 */
export function hashPayload(normalized: string): string {
  const bytes = new TextEncoder().encode(normalized);
  return '0x' + bytesToHex(keccak256(bytes));
}

// ─── ECDSA Signing ───────────────────────

let _privateKey: Uint8Array | null = null;

/**
 * Load the ECDSA private key from env.
 * Called once at startup.
 */
export function loadSigningKey(): void {
  const keyHex = process.env.ECDSA_PRIVATE_KEY;
  if (!keyHex) {
    throw new Error('ECDSA_PRIVATE_KEY not set in environment');
  }
  _privateKey = hexToBytes(keyHex);

  // Validate the key is on the curve
  try {
    secp256k1.getPublicKey(_privateKey);
  } catch {
    throw new Error('ECDSA_PRIVATE_KEY is not a valid secp256k1 private key');
  }
}

/**
 * Get the public key (for verification / contract ownership).
 */
export function getPublicKey(): string {
  if (!_privateKey) throw new Error('Signing key not loaded');
  return '0x' + bytesToHex(secp256k1.getPublicKey(_privateKey));
}

/**
 * Sign a proof hash with ECDSA secp256k1.
 * Returns compact signature + recovery byte (EVM-compatible).
 * Format: 0x{r:32bytes}{s:32bytes}{v:1byte} = 132 hex chars
 */
export function signProof(proofHash: string): string {
  if (!_privateKey) throw new Error('Signing key not loaded');

  const msgBytes = hexToBytes(proofHash.slice(2));
  const sig = secp256k1.sign(msgBytes, _privateKey);

  // Compact format + recovery byte for ecrecover compatibility
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery === 0 ? '1b' : '1c';

  return '0x' + r + s + v;
}

// ─── AES-256-GCM Encryption ─────────────

let _encryptionKey: Buffer | null = null;

/**
 * Load the AES encryption key from env.
 */
export function loadEncryptionKey(): void {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  _encryptionKey = Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a string with AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all hex)
 */
export function encrypt(plaintext: string): string {
  if (!_encryptionKey) throw new Error('Encryption key not loaded');

  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', _encryptionKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 */
export function decrypt(encrypted: string): string {
  if (!_encryptionKey) throw new Error('Encryption key not loaded');

  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const [ivHex, tagHex, ciphertext] = parts;
  const decipher = createDecipheriv('aes-256-gcm', _encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ─── Full Pipeline ───────────────────────

export interface GeneratedProof {
  proof_hash: string;
  signature_encrypted: string;
  nonce: number;
  timestamp: number;
}

/**
 * Full proof generation pipeline:
 * 1. Build deterministic payload
 * 2. Hash with Keccak256
 * 3. Sign with ECDSA
 * 4. Encrypt signature with AES-256-GCM
 */
export function generateProof(
  agentId: string,
  ruleId: string,
  conditions: Condition[],
  actionData: Record<string, any>,
  evaluation: EvalResult[],
  ruleMet: boolean,
  nonce: number
): GeneratedProof {
  // 1. Build payload
  const payload = buildProofPayload(agentId, ruleId, conditions, actionData, evaluation, ruleMet, nonce);

  // 2. Hash
  const proofHash = hashPayload(payload);

  // 3. Sign
  const signature = signProof(proofHash);

  // 4. Encrypt signature
  const signatureEncrypted = encrypt(signature);

  return {
    proof_hash: proofHash,
    signature_encrypted: signatureEncrypted,
    nonce,
    timestamp: Math.floor(Date.now() / 1000)
  };
}
