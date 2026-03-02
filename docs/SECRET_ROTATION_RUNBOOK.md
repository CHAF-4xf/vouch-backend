# AWS Secrets Manager Rotation Runbook

## Overview

This runbook covers routine and emergency rotation procedures for VOUCH cryptographic keys stored in AWS Secrets Manager.

## Rotation Schedule

| Secret | Rotation Frequency | Risk Level | Impact if Leaked |
|--------|-------------------|------------|------------------|
| ECDSA_PRIVATE_KEY | **Annually** or on compromise | **CRITICAL** | Attackers can forge ANY proof signature |
| DEPLOYER_PRIVATE_KEY | **Annually** or on compromise | **HIGH** | Attackers can forge on-chain transactions |
| ENCRYPTION_KEY | **Quarterly** or on compromise | **MEDIUM** | Past signatures can be decrypted |

## Types of Rotation

1. **Scheduled Rotation**: Routine key updates (no suspected compromise)
2. **Emergency Rotation**: Suspected key leak or compromise
3. **Post-Incident Rotation**: Confirmed security incident

---

## Scheduled Rotation (Routine)

### Prerequisites
- [ ] Schedule during maintenance window (low traffic)
- [ ] Notify team 48 hours in advance
- [ ] Backup current database
- [ ] Test rollback plan in staging

### Rotation Steps

#### 1. Generate New Key

```bash
# For ECDSA private key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# For encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# For deployer key (blockchain wallet)
# Use a secure wallet generator or:
openssl rand -hex 32
```

#### 2. Update Secret in AWS

```bash
# Update the secret value
aws secretsmanager update-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --secret-string "NEW_KEY_VALUE_HERE" \
  --region us-east-1

# Verify version was created
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1
```

#### 3. Clear Cache (Force Reload)

**Option A: Wait 30 minutes** (cache expires naturally)

**Option B: Restart service** (immediate reload)

```bash
# Railway
railway restart --service vouch-backend

# Or docker
docker restart vouch-backend
```

**Option C: Force cache clear via admin endpoint** (if implemented)

```bash
curl -X POST https://api.getvouched.ai/admin/secrets/reload \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

#### 4. Verify New Key Works

```bash
# Test proof generation
curl -X POST https://api.getvouched.ai/v1/prove \
  -H "Authorization: Bearer sk_live_TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "test-agent",
    "rule_id": "test-rule",
    "action_data": {"test": true}
  }'

# Check logs for successful key load
railway logs --service vouch-backend | grep "ECDSA signing key validated"
```

#### 5. Monitor for Issues

- **Watch logs**: No signing errors for 1 hour
- **Check metrics**: Proof generation success rate
- **Verify blockchain**: Batch job still submits transactions

#### 6. Archive Old Secret Version

```bash
# Get version IDs
aws secretsmanager list-secret-version-ids \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1

# Optional: Store old version in secure backup
# (in case rollback needed within 30 days)
```

---

## Emergency Rotation (Suspected Compromise)

### Immediate Actions (< 5 minutes)

1. **Alert team**: Notify security team and engineering lead
2. **Assess impact**: Review recent CloudTrail logs for unauthorized access
3. **Freeze non-critical operations**: Consider pausing batch jobs

### Rapid Rotation (< 30 minutes)

#### 1. Generate new keys immediately

```bash
# All three keys
NEW_ECDSA=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NEW_DEPLOYER=$(openssl rand -hex 32)
NEW_ENCRYPTION=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

#### 2. Update all secrets

```bash
aws secretsmanager update-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --secret-string "$NEW_ECDSA" \
  --region us-east-1

aws secretsmanager update-secret \
  --secret-id vouch/production/deployer-private-key \
  --secret-string "$NEW_DEPLOYER" \
  --region us-east-1

aws secretsmanager update-secret \
  --secret-id vouch/production/encryption-key \
  --secret-string "$NEW_ENCRYPTION" \
  --region us-east-1
```

#### 3. Force immediate service restart

```bash
# Railway
railway restart --service vouch-backend

# Verify new keys loaded
railway logs --tail 100 | grep "signing key validated"
```

#### 4. Invalidate compromised proofs (if needed)

If ECDSA key was compromised, consider:
- Flagging all proofs signed with old key
- Notifying affected users
- Re-signing critical proofs

### Post-Emergency Actions (< 24 hours)

1. **Root cause analysis**: How was key exposed?
2. **Audit trail review**: Check CloudTrail for unauthorized access
3. **Update smart contracts**: If deployer key changed, update authorized signers
4. **Document incident**: Add to security incident log
5. **Team debrief**: What can we improve?

---

## ECDSA Key Rotation (Special Considerations)

**Impact**: All NEW proofs will have different signatures

**What stays the same:**
- Proof hashes (deterministic based on payload)
- Old proofs remain valid (signature stored encrypted in DB)

**What changes:**
- Public key changes (update smart contract if on-chain verification)
- Future proofs signed with new key

### Steps:

1. Generate new ECDSA key pair
2. Update AWS secret
3. **Update smart contract** (if public key is stored on-chain):

```solidity
// Update authorized signer public key
ProofRegistry.updateAuthorizedSigner(NEW_PUBLIC_KEY);
```

4. Restart service
5. Verify new proofs validate correctly

---

## Deployer Key Rotation (Blockchain Wallet)

**Impact**: New wallet address for on-chain transactions

### Steps:

1. Generate new private key (secure wallet)
2. Fund new wallet with gas (ETH for Sepolia/Mainnet)
3. Update AWS secret
4. **Update smart contract ownership**:

```solidity
// Transfer ownership to new deployer address
ProofRegistry.transferOwnership(NEW_DEPLOYER_ADDRESS);
```

5. Wait for transaction confirmation
6. Restart service
7. Verify batch job submits with new wallet

### Checklist:
- [ ] New wallet funded with sufficient gas
- [ ] Old wallet balance drained (transfer to treasury)
- [ ] Contract ownership transferred
- [ ] Multisig updated (if applicable)

---

## Encryption Key Rotation (AES-256-GCM)

**Impact**: Cannot decrypt OLD signatures encrypted with previous key

**Migration strategy:**

### Option 1: Re-encrypt all existing signatures

```sql
-- Pseudo-code for migration script
SELECT id, signature_encrypted FROM proofs WHERE created_at > NOW() - INTERVAL '90 days';

-- For each proof:
-- 1. Decrypt with old key
-- 2. Encrypt with new key
-- 3. Update database
```

### Option 2: Dual-key period (recommended)

1. Store old encryption key as `vouch/production/encryption-key-old`
2. Update code to try new key first, fallback to old key for decryption
3. Re-encrypt proofs on read (lazy migration)
4. After 30 days, remove old key

---

## Monitoring & Alerts

### CloudWatch Alarms

Set up alerts for:

```bash
# Secret access spike (potential leak)
MetricFilter: { $.eventName = "GetSecretValue" }
Threshold: > 1000 per hour

# Failed secret access (IAM issue)
MetricFilter: { $.eventName = "GetSecretValue" && $.errorCode EXISTS }
Threshold: > 5 per 5 minutes

# Secret rotation events
MetricFilter: { $.eventName = "UpdateSecret" }
Notification: Slack #security-alerts
```

### CloudTrail Monitoring

Check for unusual access patterns:

```bash
# Recent secret access
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceType,AttributeValue=AWS::SecretsManager::Secret \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --region us-east-1

# Check for access from unexpected IPs
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --query 'Events[*].[CloudTrailEvent]' \
  --output text | jq '.sourceIPAddress'
```

---

## Rollback Procedure

If new key causes issues:

### Quick Rollback (< 5 minutes)

```bash
# Revert to previous secret version
aws secretsmanager update-secret-version-stage \
  --secret-id vouch/production/ecdsa-private-key \
  --version-stage AWSCURRENT \
  --move-to-version-id PREVIOUS_VERSION_ID \
  --region us-east-1

# Restart service
railway restart --service vouch-backend
```

### Verify Rollback

```bash
# Check current version
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --query 'VersionIdsToStages'

# Test proof generation
curl -X POST https://api.getvouched.ai/v1/prove [...]
```

---

## Compliance & Audit

### Documentation Required

For each rotation, document:
- **Date/Time**: When rotation occurred
- **Reason**: Scheduled/emergency/post-incident
- **Operator**: Who performed rotation
- **New Key Info**: Secret version ID, public key (if applicable)
- **Verification**: Test results, monitoring observations
- **Issues**: Any problems encountered

### Audit Trail

All secret access is logged in CloudTrail:
- Who accessed secrets
- When they were accessed
- From which IP/service
- Success/failure

Retain CloudTrail logs for 1 year (compliance requirement).

---

## Emergency Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| Security Lead | security@company.com | 24/7 |
| DevOps Lead | devops@company.com | Business hours |
| CTO | cto@company.com | Escalations |
| AWS Support | Enterprise support case | 24/7 |

---

## Testing Rotation in Staging

**Monthly drill**: Practice rotation in staging environment

```bash
# 1. Update staging secret
aws secretsmanager update-secret \
  --secret-id vouch/staging/ecdsa-private-key \
  --secret-string "TEST_KEY_$(date +%s)" \
  --region us-east-1

# 2. Restart staging
railway restart --service vouch-backend --environment staging

# 3. Run integration tests
npm run test:integration

# 4. Verify cache behavior
# Wait 30 minutes, check cache hit logs

# 5. Practice rollback
aws secretsmanager update-secret-version-stage [...]
```

---

## Automation (Future Enhancement)

Consider implementing:

1. **Automatic rotation lambda** (AWS Secrets Manager rotation function)
2. **Key expiration alerts** (90-day warning)
3. **Admin API endpoint** for cache clearing
4. **Health check endpoint** showing secret freshness
5. **Automated testing** post-rotation

---

## Summary Checklist

- [ ] Rotation scheduled and communicated
- [ ] New keys generated securely
- [ ] AWS secrets updated
- [ ] Service restarted (or cache cleared)
- [ ] Functionality verified
- [ ] Smart contracts updated (if needed)
- [ ] Monitoring checked (no errors)
- [ ] Incident documented
- [ ] Old keys archived securely
- [ ] Team notified of completion

---

**Last Updated**: 2026-02-25  
**Next Review**: 2026-05-25 (quarterly)
