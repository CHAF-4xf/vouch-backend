# VOUCH Backend Documentation

## AWS Secrets Manager Security Fix

This directory contains complete documentation for migrating VOUCH private keys from Railway environment variables to AWS Secrets Manager.

---

## Quick Navigation

### 🚀 Getting Started

**New to this migration?** Start here:

1. **[Quick Start Guide](SECRETS_MANAGER_QUICKSTART.md)** (1 hour)  
   Fast-track migration with step-by-step commands

2. **[Implementation Summary](IMPLEMENTATION_SUMMARY.md)**  
   What was built, why, and what's next

---

### 📚 Detailed Documentation

#### Planning & Migration

- **[AWS Secrets Manager Migration Guide](AWS_SECRETS_MANAGER_MIGRATION.md)**  
  Comprehensive migration instructions with staging/production rollout plan

#### Operations

- **[Secret Rotation Runbook](SECRET_ROTATION_RUNBOOK.md)**  
  Scheduled and emergency rotation procedures

- **[AWS CLI Commands Reference](AWS_CLI_COMMANDS.md)**  
  Complete CLI command reference for secret management

---

## Document Purpose Matrix

| Document | Audience | When to Use |
|----------|----------|-------------|
| [Quick Start](SECRETS_MANAGER_QUICKSTART.md) | DevOps | Initial migration (1 hour) |
| [Implementation Summary](IMPLEMENTATION_SUMMARY.md) | Engineers | Code review, understanding changes |
| [Migration Guide](AWS_SECRETS_MANAGER_MIGRATION.md) | DevOps | Detailed migration planning |
| [Rotation Runbook](SECRET_ROTATION_RUNBOOK.md) | Ops Team | Key rotation events |
| [CLI Commands](AWS_CLI_COMMANDS.md) | Everyone | Day-to-day secret management |

---

## Migration Phases

### Phase 1: Staging (This Week)
✅ Code complete  
🔄 Create AWS secrets  
🔄 Configure IAM  
🔄 Deploy to staging  
🔄 Test for 24 hours  

**See**: [Quick Start Guide](SECRETS_MANAGER_QUICKSTART.md)

---

### Phase 2: Production (Next Week)
🔄 Deploy to production  
🔄 Monitor for 7 days  
🔄 Remove legacy env vars  

**See**: [Migration Guide](AWS_SECRETS_MANAGER_MIGRATION.md)

---

### Phase 3: Operations (Ongoing)
🔄 Schedule annual rotation  
🔄 Set up monitoring alerts  
🔄 Train team on procedures  

**See**: [Rotation Runbook](SECRET_ROTATION_RUNBOOK.md)

---

## Key Concepts

### Three Keys Being Migrated

1. **DEPLOYER_PRIVATE_KEY** → AWS Secrets Manager
   - Blockchain transaction signing
   - Impact: Forged on-chain proofs

2. **ECDSA_PRIVATE_KEY** → AWS Secrets Manager
   - Proof payload signing
   - Impact: Forged proof signatures (CRITICAL)

3. **ENCRYPTION_KEY** → AWS Secrets Manager
   - Signature encryption
   - Impact: Decryption of stored signatures

### Migration Strategy

**Zero-downtime approach:**
1. Add AWS Secrets Manager integration
2. Keep legacy env vars as fallback
3. Deploy and test
4. Remove legacy vars after stabilization

**Fallback:** If AWS fails, code automatically uses legacy env vars

---

## Architecture

```
┌─────────────────┐
│ VOUCH Backend   │
│  (Railway)      │
└────────┬────────┘
         │
         │ Fetch secrets (30min cache)
         ▼
┌─────────────────────┐
│ AWS Secrets Manager │
│                     │
│ • deployer-key      │
│ • ecdsa-key         │
│ • encryption-key    │
└─────────────────────┘
         │
         │ Access logged
         ▼
┌─────────────────┐
│ AWS CloudTrail  │
│ (Audit logs)    │
└─────────────────┘
```

---

## Security Benefits

| Risk | Before | After |
|------|--------|-------|
| Process dumps | ❌ Exposed | ✅ Protected |
| Log leaks | ❌ Visible | ✅ Encrypted |
| Audit trail | ❌ None | ✅ CloudTrail |
| Rotation | ❌ Manual | ✅ Automated |
| Access control | ❌ Railway only | ✅ IAM policies |

**Cost:** ~$1.25/month for significantly improved security

---

## Testing

### Test Suite

**Command:** `npm run test:secrets`

**Coverage:**
- ✅ AWS connectivity
- ✅ Secret fetching
- ✅ Caching (30min TTL)
- ✅ Key loading
- ✅ Rotation simulation
- ✅ Error handling

### Manual Testing

```bash
# 1. Deploy to staging
railway deploy --environment staging

# 2. Check logs
railway logs --tail | grep secrets

# 3. Test proof generation
curl -X POST https://staging.api.getvouched.ai/v1/prove \
  -H "Authorization: Bearer sk_test_..." \
  -d '{"agent_id": "test", "rule_id": "test", "action_data": {}}'

# 4. Verify batch job
npm run batch
```

---

## Troubleshooting

### Common Issues

**"Access denied to secret"**
→ Check IAM policy attached to Railway role

**"Secret not found"**
→ Verify secret name matches exactly (case-sensitive)

**"AWS credentials not configured"**
→ Attach IAM role to Railway or set AWS_ACCESS_KEY_ID

**Keys not loading**
→ Check logs for fallback to env vars

### Quick Fixes

```bash
# Test AWS access manually
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1

# List all VOUCH secrets
aws secretsmanager list-secrets \
  --filters Key=name,Values=vouch/ \
  --region us-east-1

# Check IAM permissions
aws iam list-attached-role-policies \
  --role-name RailwayVouchBackend
```

---

## Rollback

### Emergency Rollback (No Code Change)

```bash
# In Railway, delete these environment variables:
AWS_SECRET_DEPLOYER_KEY
AWS_SECRET_ECDSA_KEY
AWS_SECRET_ENCRYPTION_KEY

# Code automatically falls back to:
DEPLOYER_PRIVATE_KEY
ECDSA_PRIVATE_KEY
ENCRYPTION_KEY
```

**Recovery time:** Immediate (next request)

---

## Compliance

### Rotation Schedule

- **ECDSA_PRIVATE_KEY**: Annually
- **DEPLOYER_PRIVATE_KEY**: Annually
- **ENCRYPTION_KEY**: Quarterly

### Audit Requirements

- CloudTrail logs retained 1 year
- Rotation events documented
- Access reviews quarterly
- Incident response tested annually

**See:** [Rotation Runbook](SECRET_ROTATION_RUNBOOK.md) for procedures

---

## Support

### Documentation

- All docs in `/docs` folder
- Test scripts in `/scripts`
- Implementation in `/src/services/secrets-manager.ts`

### External Resources

- [AWS Secrets Manager Docs](https://docs.aws.amazon.com/secretsmanager/)
- [AWS CLI Reference](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/secretsmanager/)
- [IAM Policy Examples](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_examples.html)

---

## Success Metrics

**Deployment Success:**
- ✅ Service starts without errors
- ✅ Secrets load successfully
- ✅ Cache hits after 30 minutes
- ✅ Proof generation works
- ✅ Batch job submits transactions

**Security Success:**
- ✅ Keys not in Railway env vars
- ✅ CloudTrail shows expected access
- ✅ No keys in logs
- ✅ IAM restricts access properly

**Operational Success:**
- ✅ No performance degradation
- ✅ Team trained on rotation
- ✅ Runbook tested
- ✅ Monitoring configured

---

## Timeline

**Implementation**: ✅ Complete (2 hours)  
**Code Review**: 🔄 Pending (1 hour)  
**Staging Test**: 🔄 Pending (24 hours)  
**Production Deploy**: 🔄 Pending (1 hour)  
**Monitoring**: 🔄 Pending (7 days)  
**Cleanup**: 🔄 Pending (1 hour)  

**Launch Date**: Friday (unblocked) ✅

---

## Contact

**Questions?** Check the relevant doc first:
- Migration → [Migration Guide](AWS_SECRETS_MANAGER_MIGRATION.md)
- Rotation → [Rotation Runbook](SECRET_ROTATION_RUNBOOK.md)
- Commands → [CLI Commands](AWS_CLI_COMMANDS.md)
- Quick help → [Quick Start](SECRETS_MANAGER_QUICKSTART.md)

---

**Last Updated**: 2026-02-25  
**Status**: Implementation Complete, Ready for Testing
