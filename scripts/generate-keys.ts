// ═══════════════════════════════════════════
// VOUCH Key Generator
// Run: npm run generate-keys
// Generates ECDSA, AES, and JWT keys for .env
// ═══════════════════════════════════════════

import { randomBytes } from 'crypto';
import { generateKeyPairSync } from 'crypto';
import { secp256k1 } from 'ethereum-cryptography/secp256k1';
import { bytesToHex } from 'ethereum-cryptography/utils';

console.log('═══════════════════════════════════════');
console.log('  VOUCH Key Generator');
console.log('  Copy these values into your .env file');
console.log('═══════════════════════════════════════\n');

// 1. ECDSA Private Key (secp256k1)
const ecdsaPrivateKey = randomBytes(32);
const ecdsaPublicKey = secp256k1.getPublicKey(ecdsaPrivateKey);

console.log('# ECDSA Signing Key (secp256k1)');
console.log(`ECDSA_PRIVATE_KEY=${bytesToHex(ecdsaPrivateKey)}`);
console.log(`# Public key (for contract verification): 0x${bytesToHex(ecdsaPublicKey)}`);
console.log('');

// 2. AES-256 Encryption Key
const aesKey = randomBytes(32);
console.log('# AES-256-GCM Encryption Key');
console.log(`ENCRYPTION_KEY=${aesKey.toString('hex')}`);
console.log('');

// 3. JWT RS256 Key Pair
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log('# JWT RS256 Key Pair');
console.log('# Replace newlines with \\n for .env:');
console.log(`JWT_PRIVATE_KEY=${(privateKey as string).replace(/\n/g, '\\n')}`);
console.log('');
console.log(`JWT_PUBLIC_KEY=${(publicKey as string).replace(/\n/g, '\\n')}`);
console.log('');

// 4. Dev-only: HS256 fallback secret
const jwtSecret = randomBytes(48).toString('base64');
console.log('# JWT HS256 Fallback (dev only — use RS256 in production)');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log('');

console.log('═══════════════════════════════════════');
console.log('  ⚠️  Save these keys securely!');
console.log('  Never commit .env to version control.');
console.log('═══════════════════════════════════════');
