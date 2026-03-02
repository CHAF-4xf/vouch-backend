# AWS Secrets Manager Quick Start

**Goal**: Migrate VOUCH private keys from Railway environment variables to AWS Secrets Manager in < 1 hour.

## Prerequisites Checklist

- [ ] AWS account with admin access
- [ ] AWS CLI installed (`aws --version`)
- [ ] AWS credentials configured (`aws sts get-caller-identity`)
- [ ] Railway project access
- [ ] Current values of DEPLOYER_PRIVATE_KEY, ECDSA_PRIVATE_KEY, ENCRYPTION_KEY

## 5-Step Migration (Production)

### Step 1: Create Secrets in AWS (10 minutes)

```bash
# Set your account variables
export AWS_REGION="us-east-1"
export DEPLOYER_KEY="your_deployer_private_key_from_railway"
export ECDSA_KEY="your_ecdsa_private_key_from_railway"
export ENCRYPTION_KEY="your_encryption_key_from_railway"

# Create all three secrets
aws secretsmanager create-secret \
  --name vouch/production/deployer-private-key \
  --description "VOUCH blockchain deployer key" \
  --secret-string "$DEPLOYER_KEY" \
  --region $AWS_REGION

aws secretsmanager create-secret \
  --name vouch/production/ecdsa-private-key \
  --description "VOUCH ECDSA proof signing key" \
  --secret-string "$ECDSA_KEY" \
  --region $AWS_REGION

aws secretsmanager create-secret \
  --name vouch/production/encryption-key \
  --description "VOUCH AES-256-GCM encryption key" \
  --secret-string "$ENCRYPTION_KEY" \
  --region $AWS_REGION

# Verify
aws secretsmanager list-secrets --filters Key=name,Values=vouch/production/ --region $AWS_REGION
```

**Expected output**: 3 secrets created successfully

---

### Step 2: Configure IAM Permissions (10 minutes)

**Create policy document:**

```bash
cat > vouch-secrets-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:vouch/production/*"
    }
  ]
}
EOF
```

**Create and attach policy:**

```bash
# Get your AWS account ID
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create policy
aws iam create-policy \
  --policy-name VouchSecretsReadPolicy \
  --policy-document file://vouch-secrets-policy.json

# Attach to Railway execution role (replace RAILWAY_ROLE_NAME)
aws iam attach-role-policy \
  --role-name RAILWAY_ROLE_NAME \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/VouchSecretsReadPolicy
```

**If Railway doesn't have an IAM role yet:**
- Go to AWS IAM → Roles → Create Role
- Select "AWS service" → EC2 (or relevant service)
- Attach VouchSecretsReadPolicy
- Name it `RailwayVouchBackend`
- Assign this role to Railway deployment

---

### Step 3: Update Railway Environment Variables (5 minutes)

**In Railway dashboard, ADD these variables:**

```bash
AWS_REGION=us-east-1
AWS_SECRET_DEPLOYER_KEY=vouch/production/deployer-private-key
AWS_SECRET_ECDSA_KEY=vouch/production/ecdsa-private-key
AWS_SECRET_ENCRYPTION_KEY=vouch/production/encryption-key
```

**KEEP these variables for now (fallback during testing):**

```bash
DEPLOYER_PRIVATE_KEY=<existing_value>
ECDSA_PRIVATE_KEY=<existing_value>
ENCRYPTION_KEY=<existing_value>
```

**Important**: Don't remove old variables yet! They serve as fallback if AWS fails.

---

### Step 4: Deploy and Test (15 minutes)

```bash
# Deploy updated code
git push railway main

# Watch logs
railway logs --tail

# Look for these SUCCESS messages:
# [secrets] Fetching vouch/production/ecdsa-private-key from AWS Secrets Manager...
# [secrets] ✓ vouch/production/ecdsa-private-key loaded and cached for 30 minutes
# [proof-gen] ✓ ECDSA signing key validated
# [proof-gen] ✓ Encryption key loaded
```

**Test proof generation:**

```bash
curl -X POST https://api.getvouched.ai/v1/prove \
  -H "Authorization: Bearer sk_live_YOUR_TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "test-agent-id",
    "rule_id": "test-rule-id",
    "action_data": {"test": true}
  }'
```

**Expected**: Successful proof with `proof_hash` and `signature_encrypted`

---

### Step 5: Monitor and Cleanup (20 minutes)

**Monitor for 30 minutes:**

```bash
# Check cache is working (should see cache hits after 1st load)
railway logs --tail | grep "cache hit"

# Check CloudTrail for secret access
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --start-time $(date -u -d '30 minutes ago' +%s) \
  --region us-east-1
```

**After 1 week of stable operation:**

Remove legacy environment variables from Railway:
- DEPLOYER_PRIVATE_KEY
- ECDSA_PRIVATE_KEY
- ENCRYPTION_KEY

---

## Staging Environment (Test First!)

**Recommended**: Test in staging before production.

```bash
# Create staging secrets
aws secretsmanager create-secret \
  --name vouch/staging/deployer-private-key \
  --secret-string "$STAGING_DEPLOYER_KEY" \
  --region us-east-1

aws secretsmanager create-secret \
  --name vouch/staging/ecdsa-private-key \
  --secret-string "$STAGING_ECDSA_KEY" \
  --region us-east-1

aws secretsmanager create-secret \
  --name vouch/staging/encryption-key \
  --secret-string "$STAGING_ENCRYPTION_KEY" \
  --region us-east-1

# Update Railway staging environment variables
AWS_SECRET_DEPLOYER_KEY=vouch/staging/deployer-private-key
AWS_SECRET_ECDSA_KEY=vouch/staging/ecdsa-private-key
AWS_SECRET_ENCRYPTION_KEY=vouch/staging/encryption-key
```

---

## Troubleshooting

### Error: "Access denied to secret"

**Fix IAM permissions:**

```bash
# Verify policy is attached
aws iam list-attached-role-policies --role-name RAILWAY_ROLE_NAME

# Test access manually
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1
```

### Error: "Secret not found"

**Verify secret exists:**

```bash
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1
```

### Error: "AWS credentials not configured"

**Railway needs IAM role assigned:**
- Create IAM role with Secrets Manager policy
- Attach role to Railway service
- Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Railway (less secure)

### Fallback to environment variables

If AWS fails, code automatically falls back to legacy env vars. Check logs:

```
[proof-gen] AWS_SECRET_ECDSA_KEY not set, using ECDSA_PRIVATE_KEY env var
```

---

## Verification Checklist

- [ ] All 3 secrets created in AWS Secrets Manager
- [ ] IAM policy created and attached to Railway role
- [ ] Railway environment variables updated (AWS_SECRET_* added)
- [ ] Deployment successful
- [ ] Logs show "loaded and cached for 30 minutes"
- [ ] Test proof generation successful
- [ ] Cache hits appear in logs after 30 minutes
- [ ] No errors in logs for 24 hours
- [ ] CloudTrail shows expected access patterns

---

## Rollback Plan

If anything goes wrong:

1. **Immediate**: Remove AWS_SECRET_* variables from Railway
   - Code will fallback to legacy env vars (DEPLOYER_PRIVATE_KEY, etc.)
   - No code deployment needed

2. **If Railway is down**: Restore previous git commit

---

## Cost

**Expected monthly cost**: ~$1.25

- 3 secrets × $0.40/month = $1.20
- ~5,000 API calls/month × $0.05/10,000 = $0.025
- **Total: $1.225/month**

---

## Next Steps After Migration

1. **Document** the change in team wiki
2. **Schedule** first rotation (1 year out)
3. **Set up** CloudWatch alarms for unusual secret access
4. **Train** team on rotation runbook
5. **Archive** old environment variable values securely

---

## Support

- **Migration docs**: `/docs/AWS_SECRETS_MANAGER_MIGRATION.md`
- **Rotation runbook**: `/docs/SECRET_ROTATION_RUNBOOK.md`
- **CLI reference**: `/docs/AWS_CLI_COMMANDS.md`
- **Test script**: `npm run test:secrets`

---

**Estimated total time**: 1 hour  
**Risk level**: Low (automatic fallback to legacy env vars)  
**Impact**: High (significantly improved security posture)
