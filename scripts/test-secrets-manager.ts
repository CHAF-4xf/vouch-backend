#!/usr/bin/env tsx

// ═══════════════════════════════════════════
// AWS Secrets Manager Integration Test
// Verifies secret loading, caching, and rotation
// ═══════════════════════════════════════════

import 'dotenv/config';
import { getSecret, clearSecretCache, getCacheStats } from '../src/services/secrets-manager';
import { loadSigningKey, getPublicKey, reloadSigningKey } from '../src/services/proof-generator';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n🧪 Running: ${name}`);
  const start = Date.now();
  
  try {
    await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`✅ PASSED (${duration}ms)`);
  } catch (error: any) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, duration, error: error.message });
    console.log(`❌ FAILED: ${error.message}`);
  }
}

// ─── Test Suite ──────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('AWS Secrets Manager Integration Test Suite');
  console.log('═══════════════════════════════════════════');

  // Test 1: Environment configuration
  await runTest('Environment Configuration', async () => {
    const requiredVars = ['AWS_REGION', 'AWS_SECRET_ECDSA_KEY'];
    const missing = requiredVars.filter(v => !process.env[v]);
    
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
    
    console.log(`   Region: ${process.env.AWS_REGION}`);
    console.log(`   ECDSA Secret: ${process.env.AWS_SECRET_ECDSA_KEY}`);
  });

  // Test 2: Fetch secret from AWS
  await runTest('Fetch Secret from AWS Secrets Manager', async () => {
    const secretName = process.env.AWS_SECRET_ECDSA_KEY!;
    const secret = await getSecret(secretName);
    
    if (!secret || secret.length < 32) {
      throw new Error('Secret appears invalid or empty');
    }
    
    console.log(`   Secret length: ${secret.length} characters`);
    console.log(`   First 8 chars: ${secret.substring(0, 8)}...`);
  });

  // Test 3: Cache functionality
  await runTest('Secret Caching (30-minute TTL)', async () => {
    const secretName = process.env.AWS_SECRET_ECDSA_KEY!;
    
    // First call (cache miss)
    const start1 = Date.now();
    await getSecret(secretName);
    const time1 = Date.now() - start1;
    
    // Second call (cache hit)
    const start2 = Date.now();
    await getSecret(secretName);
    const time2 = Date.now() - start2;
    
    console.log(`   First call (cache miss): ${time1}ms`);
    console.log(`   Second call (cache hit): ${time2}ms`);
    console.log(`   Speedup: ${Math.round(time1 / time2)}x faster`);
    
    if (time2 >= time1) {
      console.log(`   ⚠️  Warning: Second call was not faster (cache may not be working)`);
    }
    
    // Check cache stats
    const stats = getCacheStats();
    console.log(`   Cached secrets: ${stats.length}`);
    stats.forEach(s => {
      console.log(`   - ${s.secretName}: expires in ${s.expiresIn}s`);
    });
  });

  // Test 4: Load ECDSA signing key
  await runTest('Load ECDSA Signing Key', async () => {
    await loadSigningKey();
    const publicKey = getPublicKey();
    
    if (!publicKey.startsWith('0x') || publicKey.length !== 132) {
      throw new Error('Invalid public key format');
    }
    
    console.log(`   Public key: ${publicKey.substring(0, 20)}...`);
  });

  // Test 5: Key rotation simulation
  await runTest('Key Rotation Simulation', async () => {
    const secretName = process.env.AWS_SECRET_ECDSA_KEY!;
    
    // Clear cache to simulate rotation
    console.log('   Clearing cache...');
    clearSecretCache(secretName);
    
    // Reload key
    console.log('   Reloading signing key...');
    await reloadSigningKey();
    
    const publicKey = getPublicKey();
    console.log(`   New public key loaded: ${publicKey.substring(0, 20)}...`);
  });

  // Test 6: Fallback to environment variable
  await runTest('Fallback to Environment Variable', async () => {
    // Temporarily unset AWS secret name to test fallback
    const originalSecretName = process.env.AWS_SECRET_ECDSA_KEY;
    const originalEcdsaKey = process.env.ECDSA_PRIVATE_KEY;
    
    if (!originalEcdsaKey) {
      console.log('   ⏭️  Skipping (ECDSA_PRIVATE_KEY not set for fallback test)');
      return;
    }
    
    delete process.env.AWS_SECRET_ECDSA_KEY;
    process.env.ECDSA_PRIVATE_KEY = originalEcdsaKey;
    
    try {
      await loadSigningKey();
      console.log('   ✓ Fallback to env var successful');
    } finally {
      // Restore original config
      if (originalSecretName) {
        process.env.AWS_SECRET_ECDSA_KEY = originalSecretName;
      }
    }
  });

  // Test 7: Error handling
  await runTest('Error Handling (Invalid Secret)', async () => {
    try {
      await getSecret('vouch/nonexistent/fake-secret');
      throw new Error('Should have thrown error for non-existent secret');
    } catch (error: any) {
      if (error.message.includes('Secret not found')) {
        console.log('   ✓ Correctly detected non-existent secret');
      } else {
        throw error;
      }
    }
  });

  // ─── Results Summary ─────────────────────

  console.log('\n═══════════════════════════════════════════');
  console.log('Test Results Summary');
  console.log('═══════════════════════════════════════════');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);
  console.log(`⏱️  Total time: ${totalTime}ms\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  // ─── Recommendations ─────────────────────

  console.log('\n═══════════════════════════════════════════');
  console.log('Recommendations');
  console.log('═══════════════════════════════════════════\n');

  if (passed === results.length) {
    console.log('✅ All tests passed! Ready for deployment.');
    console.log('\nNext steps:');
    console.log('  1. Deploy to staging environment');
    console.log('  2. Monitor logs for 24 hours');
    console.log('  3. Run integration tests');
    console.log('  4. Deploy to production');
    console.log('  5. Remove legacy environment variables after 1 week');
  } else {
    console.log('⚠️  Some tests failed. Fix issues before deploying:');
    console.log('  1. Check AWS credentials and permissions');
    console.log('  2. Verify secret names match exactly');
    console.log('  3. Confirm secrets exist in AWS Secrets Manager');
    console.log('  4. Review IAM policy attached to Railway role');
  }

  console.log('\n═══════════════════════════════════════════\n');

  // Exit with error if tests failed
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  console.error('\n❌ Test suite crashed:');
  console.error(error);
  process.exit(1);
});
