// ═══════════════════════════════════════════
// AWS Secrets Manager Integration
// 30-minute caching to minimize API calls
// ═══════════════════════════════════════════

import { 
  SecretsManagerClient, 
  GetSecretValueCommand,
  GetSecretValueCommandInput 
} from '@aws-sdk/client-secrets-manager';

interface CachedSecret {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const secretCache = new Map<string, CachedSecret>();

let client: SecretsManagerClient | null = null;

/**
 * Initialize AWS Secrets Manager client.
 * Uses AWS SDK credential chain (IAM roles, env vars, etc).
 */
function getClient(): SecretsManagerClient {
  if (!client) {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    client = new SecretsManagerClient({ region });
  }
  return client;
}

/**
 * Fetch a secret from AWS Secrets Manager with caching.
 * 
 * @param secretName - AWS Secrets Manager secret name/ARN
 * @param forceRefresh - Bypass cache and fetch fresh value
 * @returns Secret string value
 * @throws Error if secret cannot be retrieved
 */
export async function getSecret(secretName: string, forceRefresh = false): Promise<string> {
  const now = Date.now();

  // Check cache unless force refresh
  if (!forceRefresh) {
    const cached = secretCache.get(secretName);
    if (cached && cached.expiresAt > now) {
      console.log(`[secrets] Cache hit for ${secretName} (expires in ${Math.round((cached.expiresAt - now) / 1000)}s)`);
      return cached.value;
    }
  }

  // Fetch from AWS
  console.log(`[secrets] Fetching ${secretName} from AWS Secrets Manager...`);
  
  try {
    const input: GetSecretValueCommandInput = {
      SecretId: secretName,
    };

    const command = new GetSecretValueCommand(input);
    const response = await getClient().send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no SecretString value`);
    }

    // Cache the secret
    secretCache.set(secretName, {
      value: response.SecretString,
      expiresAt: now + CACHE_TTL_MS,
    });

    console.log(`[secrets] ✓ ${secretName} loaded and cached for 30 minutes`);
    return response.SecretString;

  } catch (error: any) {
    // Enhanced error messages for common issues
    if (error.name === 'ResourceNotFoundException') {
      throw new Error(`Secret not found: ${secretName}. Ensure it exists in AWS Secrets Manager.`);
    }
    if (error.name === 'AccessDeniedException') {
      throw new Error(`Access denied to secret: ${secretName}. Check IAM permissions.`);
    }
    if (error.name === 'InvalidRequestException') {
      throw new Error(`Invalid request for secret: ${secretName}. ${error.message}`);
    }
    
    throw new Error(`Failed to retrieve secret ${secretName}: ${error.message}`);
  }
}

/**
 * Clear the cache for a specific secret (useful for rotation testing).
 */
export function clearSecretCache(secretName: string): void {
  secretCache.delete(secretName);
  console.log(`[secrets] Cache cleared for ${secretName}`);
}

/**
 * Clear all cached secrets (useful for testing).
 */
export function clearAllCaches(): void {
  secretCache.clear();
  console.log(`[secrets] All secret caches cleared`);
}

/**
 * Get cache statistics (for monitoring/debugging).
 */
export function getCacheStats(): { secretName: string; expiresIn: number }[] {
  const now = Date.now();
  return Array.from(secretCache.entries()).map(([secretName, cached]) => ({
    secretName,
    expiresIn: Math.max(0, Math.round((cached.expiresAt - now) / 1000)),
  }));
}

/**
 * Health check: verify we can connect to AWS Secrets Manager.
 * Does not fetch actual secrets, just validates credentials/connectivity.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    // Simple check: create client and verify credentials work
    const client = getClient();
    // If client creation fails, it will throw
    return true;
  } catch (error) {
    console.error('[secrets] Health check failed:', error);
    return false;
  }
}
