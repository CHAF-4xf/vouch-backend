# AWS Secrets Manager Migration Guide

## Overview

This migration moves sensitive cryptographic keys from Railway environment variables to AWS Secrets Manager, providing:

- **Enhanced Security**: Keys never appear in process listings, logs, or error dumps
- **Audit Trail**: AWS CloudTrail logs all secret access
- **Rotation Support**: Built-in secret rotation capabilities
- **Caching**: 30-minute cache reduces AWS API calls and improves performance

## Keys Being Migrated

1. **DEPLOYER_PRIVATE_KEY** → `vouch/production/deployer-private-key`
   - Used for: Signing blockchain transactions (batch proof registration)
   - Impact if leaked: Attacker can forge on-chain proof submissions

2. **ECDSA_PRIVATE_KEY** → `vouch/production/ecdsa-private-key`
   - Used for: Signing proof payloads
   - Impact if leaked: Attacker can forge ANY proof signature (critical)

3. **ENCRYPTION_KEY** → `vouch/production/encryption-key`
   - Used for: AES-256-GCM encryption of signatures
   - Impact if leaked: Attacker can decrypt stored signatures

## Prerequisites

- AWS account with Secrets Manager access
- AWS CLI installed and configured (`aws configure`)
- IAM role or user with permissions:
  - `secretsmanager:CreateSecret`
  - `secretsmanager:GetSecretValue`
  - `secretsmanager:UpdateSecret`
  - `secretsmanager:DescribeSecret`

## Step 1: Create Secrets in AWS

### 1.1 Create DEPLOYER_PRIVATE_KEY secret

```bash
# Get current value from Railway (or .env)
DEPLOYER_KEY="your_deployer_private_key_hex_here"

# Create secret in AWS Secrets Manager
aws secretsmanager create-secret \
  --name vouch/production/deployer-private-key \
  --description "VOUCH blockchain deployer private key for on-chain proof registration" \
  --secret-string "$DEPLOYER_KEY" \
  --region us-east-1

# Verify it was created
aws secretsmanager describe-secret \
  --secret-id vouch/production/deployer-private-key \
  --region us-east-1
```

### 1.2 Create ECDSA_PRIVATE_KEY secret

```bash
# Get current value from Railway
ECDSA_KEY="your_ecdsa_private_key_hex_here"

# Create secret
aws secretsmanager create-secret \
  --name vouch/production/ecdsa-private-key \
  --description "VOUCH ECDSA secp256k1 private key for proof signing" \
  --secret-string "$ECDSA_KEY" \
  --region us-east-1

# Verify
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1
```

### 1.3 Create ENCRYPTION_KEY secret

```bash
# Get current value from Railway
ENCRYPTION_KEY="your_encryption_key_hex_here"

# Create secret
aws secretsmanager create-secret \
  --name vouch/production/encryption-key \
  --description "VOUCH AES-256-GCM encryption key" \
  --secret-string "$ENCRYPTION_KEY" \
  --region us-east-1

# Verify
aws secretsmanager describe-secret \
  --secret-id vouch/production/encryption-key \
  --region us-east-1
```

## Step 2: Configure IAM Permissions

### Railway Deployment IAM Policy

Create an IAM policy for Railway's service role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VouchSecretsAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:vouch/production/*"
      ]
    }
  ]
}
```

Attach this policy to the IAM role used by Railway (or the EC2/ECS task role if self-hosted).

## Step 3: Update Railway Environment Variables

### Add new environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1

# Secret names (not the values!)
AWS_SECRET_DEPLOYER_KEY=vouch/production/deployer-private-key
AWS_SECRET_ECDSA_KEY=vouch/production/ecdsa-private-key
AWS_SECRET_ENCRYPTION_KEY=vouch/production/encryption-key
```

### Keep legacy variables during transition:

```bash
# Keep these as fallback during testing
DEPLOYER_PRIVATE_KEY=<current_value>
ECDSA_PRIVATE_KEY=<current_value>
ENCRYPTION_KEY=<current_value>
```

## Step 4: Staged Rollout

### 4.1 Staging Environment (Railway Testnet)

1. Deploy updated code to staging
2. Verify logs show: `Loading [key] from AWS Secrets Manager...`
3. Test proof generation works
4. Test batch job works
5. Monitor for 24 hours

### 4.2 Production Cutover

1. Deploy to production with AWS secret names configured
2. Monitor logs for successful secret loading
3. Generate test proof via API
4. Wait 30 minutes, generate another (cache hit should appear in logs)
5. Once stable, remove legacy environment variables from Railway

## Step 5: Verification

### Check logs for successful secret loading:

```
[secrets] Fetching vouch/production/deployer-private-key from AWS Secrets Manager...
[secrets] ✓ vouch/production/deployer-private-key loaded and cached for 30 minutes
[proof-gen] ✓ ECDSA signing key validated
[proof-gen] ✓ Encryption key loaded
```

### Test proof generation:

```bash
curl -X POST https://api.getvouched.ai/v1/prove \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "YOUR_AGENT_ID",
    "rule_id": "YOUR_RULE_ID",
    "action_data": { "test": true }
  }'
```

Should return a proof with `proof_hash` and `signature_encrypted`.

### Monitor CloudTrail for secret access:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=vouch/production/deployer-private-key \
  --region us-east-1
```

## Step 6: Cleanup

**After 1 week of stable operation:**

1. Remove legacy environment variables from Railway:
   - `DEPLOYER_PRIVATE_KEY`
   - `ECDSA_PRIVATE_KEY`
   - `ENCRYPTION_KEY`

2. Verify fallback no longer triggers (logs should not show "using env var")

## Rollback Plan

If issues occur:

1. **Immediate**: Remove AWS secret name env vars from Railway
   - Code will fallback to legacy environment variables
   - No code deployment needed

2. **If Railway is down**: Deploy previous git commit

## Cost Estimate

- **Secrets Manager**: $0.40/month per secret × 3 = $1.20/month
- **API Calls**: $0.05 per 10,000 calls
  - With 30-min caching: ~2 calls/hour × 3 secrets × 730 hours = ~4,400 calls/month
  - Cost: ~$0.02/month

**Total: ~$1.22/month for significantly enhanced security**

## Security Benefits

✅ Keys never in process memory dumps  
✅ Keys never in application logs  
✅ Keys never in error stack traces  
✅ Full audit trail of access  
✅ Automatic rotation support  
✅ Granular IAM permissions  
✅ Encrypted at rest and in transit  

## Troubleshooting

### Error: "Access denied to secret"
- Check IAM policy is attached to correct role
- Verify Railway is using the IAM role
- Check secret ARN matches policy

### Error: "Secret not found"
- Verify secret name matches exactly
- Check AWS region is correct (us-east-1)
- Run `aws secretsmanager list-secrets`

### Error: "AWS credentials not configured"
- Railway needs IAM role assigned
- For local dev: run `aws configure`
- Check AWS_REGION environment variable

### Cache not working
- Check logs for cache hit messages
- Verify 30-minute window hasn't expired
- Use `clearSecretCache()` function for testing

## Next Steps

1. Complete staging deployment and testing
2. Schedule production cutover (low-traffic window)
3. Monitor for 1 week
4. Remove legacy environment variables
5. Document in team runbook
