// ═══════════════════════════════════════════
// VOUCH Tests
// ═══════════════════════════════════════════

import { describe, test, expect, beforeAll } from 'vitest';
import { evaluateRule, validateConditions, Condition } from '../src/services/rule-engine';
import {
  buildProofPayload, hashPayload, loadSigningKey, loadEncryptionKey,
  signProof, encrypt, decrypt, generateProof
} from '../src/services/proof-generator';
import {
  hashPassword, verifyPassword, generateApiKey, hashApiKey, signJwt, verifyJwt
} from '../src/services/auth';
import { estimateBill } from '../src/utils/tiers';
import { randomBytes } from 'crypto';
import { bytesToHex } from 'ethereum-cryptography/utils';

// ═══ RULE ENGINE ═════════════════════════

describe('Rule Engine', () => {
  test('passes when all conditions met', () => {
    const conditions: Condition[] = [
      { field: 'slippage_pct', op: '<=', value: 0.5 },
      { field: 'pool_tvl', op: '>', value: 50000 },
    ];
    const action = { slippage_pct: 0.38, pool_tvl: 2100000 };
    const result = evaluateRule(conditions, action);

    expect(result.rule_met).toBe(true);
    expect(result.evaluation).toHaveLength(2);
    expect(result.evaluation[0].pass).toBe(true);
    expect(result.evaluation[1].pass).toBe(true);
    expect(result.summary).toBe('All 2 conditions passed');
  });

  test('fails when one condition fails', () => {
    const conditions: Condition[] = [
      { field: 'slippage_pct', op: '<=', value: 0.5 },
      { field: 'pool_tvl', op: '>', value: 50000 },
    ];
    const action = { slippage_pct: 0.8, pool_tvl: 2100000 };
    const result = evaluateRule(conditions, action);

    expect(result.rule_met).toBe(false);
    expect(result.evaluation[0].pass).toBe(false);
    expect(result.evaluation[0].actual).toBe(0.8);
    expect(result.summary).toBe('1 of 2 conditions failed');
  });

  test('fails on missing field', () => {
    const conditions: Condition[] = [
      { field: 'amount', op: '<=', value: 10000 },
    ];
    const result = evaluateRule(conditions, {});

    expect(result.rule_met).toBe(false);
    expect(result.evaluation[0].actual).toBeNull();
    expect(result.evaluation[0].pass).toBe(false);
  });

  test('handles equality operator', () => {
    const result = evaluateRule(
      [{ field: 'status', op: '=', value: 'active' }],
      { status: 'active' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles not-equal operator', () => {
    const result = evaluateRule(
      [{ field: 'scope', op: '!=', value: 'production' }],
      { scope: 'staging' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles IN operator', () => {
    const result = evaluateRule(
      [{ field: 'day', op: 'IN', value: ['Mon', 'Tue', 'Wed'] }],
      { day: 'Tue' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles NOT IN operator', () => {
    const result = evaluateRule(
      [{ field: 'action', op: 'NOT IN', value: ['delete', 'drop'] }],
      { action: 'select' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles CONTAINS operator', () => {
    const result = evaluateRule(
      [{ field: 'message', op: 'CONTAINS', value: 'approved' }],
      { message: 'Transaction approved by system' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles NOT CONTAINS operator', () => {
    const result = evaluateRule(
      [{ field: 'output', op: 'NOT CONTAINS', value: 'SSN' }],
      { output: 'User name: John Doe' }
    );
    expect(result.rule_met).toBe(true);
  });

  test('handles edge case: zero value', () => {
    const result = evaluateRule(
      [{ field: 'amount', op: '>=', value: 0 }],
      { amount: 0 }
    );
    expect(result.rule_met).toBe(true);
  });
});

describe('Condition Validation', () => {
  test('accepts valid conditions', () => {
    const result = validateConditions([
      { field: 'x', op: '<=', value: 5 },
    ]);
    expect(result.valid).toBe(true);
  });

  test('rejects empty array', () => {
    const result = validateConditions([]);
    expect(result.valid).toBe(false);
  });

  test('rejects invalid operator', () => {
    const result = validateConditions([
      { field: 'x', op: 'LIKE' as any, value: 5 },
    ]);
    expect(result.valid).toBe(false);
  });

  test('rejects IN with non-array value', () => {
    const result = validateConditions([
      { field: 'x', op: 'IN', value: 'not-array' },
    ]);
    expect(result.valid).toBe(false);
  });

  test('rejects numeric op with string value', () => {
    const result = validateConditions([
      { field: 'x', op: '<', value: 'not-a-number' },
    ]);
    expect(result.valid).toBe(false);
  });

  test('rejects more than 20 conditions', () => {
    const conds = Array.from({ length: 21 }, (_, i) => ({
      field: `f${i}`, op: '=' as const, value: i,
    }));
    const result = validateConditions(conds);
    expect(result.valid).toBe(false);
  });
});

// ═══ PROOF GENERATOR ═════════════════════

describe('Proof Generator', () => {
  beforeAll(() => {
    // Set test keys
    const testPrivKey = bytesToHex(randomBytes(32));
    const testEncKey = bytesToHex(randomBytes(32));
    process.env.ECDSA_PRIVATE_KEY = testPrivKey;
    process.env.ENCRYPTION_KEY = testEncKey;
    loadSigningKey();
    loadEncryptionKey();
  });

  test('buildProofPayload produces deterministic output', () => {
    const a = buildProofPayload('a1', 'r1', [], {}, [], true, 1);
    const b = buildProofPayload('a1', 'r1', [], {}, [], true, 1);
    expect(a).toBe(b);
  });

  test('hashPayload produces valid 66-char hex', () => {
    const hash = hashPayload('test payload');
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  test('hashPayload is deterministic', () => {
    const a = hashPayload('same input');
    const b = hashPayload('same input');
    expect(a).toBe(b);
  });

  test('different inputs produce different hashes', () => {
    const a = hashPayload('input a');
    const b = hashPayload('input b');
    expect(a).not.toBe(b);
  });

  test('signProof produces valid signature', () => {
    const hash = hashPayload('test');
    const sig = signProof(hash);
    expect(sig).toMatch(/^0x[a-f0-9]{130}$/); // r(64) + s(64) + v(2)
  });

  test('encrypt/decrypt roundtrip', () => {
    const original = '0x304402abcdef';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('encrypted format is iv:tag:ciphertext', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24);  // 12 bytes hex = 24 chars
    expect(parts[1]).toHaveLength(32);  // 16 bytes hex = 32 chars
  });

  test('full generateProof pipeline', () => {
    const proof = generateProof(
      'agent-1', 'rule-1',
      [{ field: 'x', op: '<=', value: 5 }],
      { x: 3 },
      [{ field: 'x', op: '<=', expected: 5, actual: 3, pass: true }],
      true, 1
    );

    expect(proof.proof_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(proof.signature_encrypted).toContain(':');
    expect(proof.nonce).toBe(1);
    expect(proof.timestamp).toBeGreaterThan(0);
  });
});

// ═══ AUTH ═════════════════════════════════

describe('Auth', () => {
  test('password hash + verify roundtrip', async () => {
    const hash = await hashPassword('MySecurePass123');
    expect(hash).not.toBe('MySecurePass123');
    expect(await verifyPassword('MySecurePass123', hash)).toBe(true);
    expect(await verifyPassword('WrongPassword', hash)).toBe(false);
  });

  test('API key generation', () => {
    const { plaintext, hash, prefix } = generateApiKey();
    expect(plaintext).toMatch(/^sk_live_[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64); // SHA-256
    expect(prefix).toContain('sk_live_');
    expect(prefix).toContain('...');
  });

  test('API key hash is consistent', () => {
    const key = 'sk_live_abc123';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  test('JWT sign + verify roundtrip', () => {
    process.env.JWT_SECRET = 'test-secret-for-testing';
    const payload = { sub: 'user-1', email: 'test@test.com', tier: 'starter' };
    const token = signJwt(payload);
    const decoded = verifyJwt(token);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('test@test.com');
    expect(decoded.tier).toBe('starter');
  });
});

// ═══ PRICING ═════════════════════════════

describe('Pricing', () => {
  test('starter tier calculates correctly', () => {
    const est = estimateBill('starter', 500);
    expect(est.base_fee).toBe(9.99);
    expect(est.overage_proofs).toBe(0);
    expect(est.total).toBe(9.99);
  });

  test('starter tier with overage', () => {
    const est = estimateBill('starter', 1500);
    expect(est.overage_proofs).toBe(500);
    expect(est.overage_cost).toBe(7.5); // 500 × $0.015
    expect(est.total).toBe(17.49);      // $9.99 + $7.50
  });

  test('growth tier calculates correctly', () => {
    const est = estimateBill('growth', 8000);
    expect(est.base_fee).toBe(99);
    expect(est.overage_proofs).toBe(0);
    expect(est.total).toBe(99);
  });

  test('free tier', () => {
    const est = estimateBill('free', 10);
    expect(est.base_fee).toBe(0);
    expect(est.total).toBe(0);
  });
});
