# AWS Secrets Manager CLI Commands

Quick reference for managing VOUCH secrets in AWS Secrets Manager.

## Prerequisites

```bash
# Install AWS CLI
brew install awscli  # macOS
# or
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure AWS CLI
aws configure
# Enter:
#   AWS Access Key ID: YOUR_ACCESS_KEY
#   AWS Secret Access Key: YOUR_SECRET_KEY
#   Default region: us-east-1
#   Default output format: json
```

## Create Secrets (Initial Setup)

### Production Secrets

```bash
# 1. DEPLOYER_PRIVATE_KEY
aws secretsmanager create-secret \
  --name vouch/production/deployer-private-key \
  --description "VOUCH blockchain deployer private key" \
  --secret-string "YOUR_DEPLOYER_KEY_HEX" \
  --region us-east-1

# 2. ECDSA_PRIVATE_KEY
aws secretsmanager create-secret \
  --name vouch/production/ecdsa-private-key \
  --description "VOUCH ECDSA proof signing key" \
  --secret-string "YOUR_ECDSA_KEY_HEX" \
  --region us-east-1

# 3. ENCRYPTION_KEY
aws secretsmanager create-secret \
  --name vouch/production/encryption-key \
  --description "VOUCH AES-256-GCM encryption key" \
  --secret-string "YOUR_ENCRYPTION_KEY_HEX" \
  --region us-east-1
```

### Staging Secrets

```bash
# Create staging versions (same structure)
aws secretsmanager create-secret \
  --name vouch/staging/deployer-private-key \
  --description "VOUCH staging deployer key" \
  --secret-string "STAGING_DEPLOYER_KEY" \
  --region us-east-1

aws secretsmanager create-secret \
  --name vouch/staging/ecdsa-private-key \
  --description "VOUCH staging ECDSA key" \
  --secret-string "STAGING_ECDSA_KEY" \
  --region us-east-1

aws secretsmanager create-secret \
  --name vouch/staging/encryption-key \
  --description "VOUCH staging encryption key" \
  --secret-string "STAGING_ENCRYPTION_KEY" \
  --region us-east-1
```

## Read Secrets

```bash
# Get secret value
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --query 'SecretString' \
  --output text

# Get secret metadata (no value)
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1

# List all VOUCH secrets
aws secretsmanager list-secrets \
  --filters Key=name,Values=vouch/ \
  --region us-east-1
```

## Update Secrets (Rotation)

```bash
# Update secret value (creates new version)
aws secretsmanager update-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --secret-string "NEW_KEY_VALUE" \
  --region us-east-1

# Update with description change
aws secretsmanager update-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --description "Rotated on $(date +%Y-%m-%d)" \
  --region us-east-1
```

## Version Management

```bash
# List all versions of a secret
aws secretsmanager list-secret-version-ids \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1

# Get specific version
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --version-id VERSION_ID_HERE \
  --region us-east-1

# Rollback to previous version
aws secretsmanager update-secret-version-stage \
  --secret-id vouch/production/ecdsa-private-key \
  --version-stage AWSCURRENT \
  --move-to-version-id PREVIOUS_VERSION_ID \
  --region us-east-1
```

## IAM Policy Management

```bash
# Create IAM policy for secret access
cat > vouch-secrets-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VouchSecretsReadAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:vouch/production/*"
    }
  ]
}
EOF

# Create policy
aws iam create-policy \
  --policy-name VouchSecretsReadPolicy \
  --policy-document file://vouch-secrets-policy.json

# Attach policy to role (e.g., Railway execution role)
aws iam attach-role-policy \
  --role-name RailwayExecutionRole \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/VouchSecretsReadPolicy

# List policies attached to role
aws iam list-attached-role-policies \
  --role-name RailwayExecutionRole
```

## Monitoring & Audit

```bash
# Get CloudTrail events for secret access (last hour)
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=vouch/production/ecdsa-private-key \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --region us-east-1

# Check who accessed secrets today
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --start-time $(date -u -d '1 day ago' +%s) \
  --region us-east-1 \
  --query 'Events[*].[CloudTrailEvent]' \
  --output text | jq -r '.userIdentity.arn, .eventTime, .sourceIPAddress'

# Get secret access count
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=vouch/production/ecdsa-private-key \
  --start-time $(date -u -d '7 days ago' +%s) \
  --region us-east-1 \
  --query 'length(Events)'
```

## Tagging

```bash
# Add tags to secrets
aws secretsmanager tag-resource \
  --secret-id vouch/production/ecdsa-private-key \
  --tags Key=Environment,Value=production Key=Project,Value=vouch Key=CriticalityLevel,Value=high \
  --region us-east-1

# List tags
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --query 'Tags'

# Remove tags
aws secretsmanager untag-resource \
  --secret-id vouch/production/ecdsa-private-key \
  --tag-keys Environment Project \
  --region us-east-1
```

## Backup & Recovery

```bash
# Export secret value (for backup)
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --query 'SecretString' \
  --output text > ecdsa-key-backup-$(date +%Y%m%d).txt

# Encrypt backup with GPG
gpg --encrypt --recipient security@company.com ecdsa-key-backup-*.txt

# Store encrypted backup in S3
aws s3 cp ecdsa-key-backup-*.txt.gpg s3://vouch-secure-backups/keys/ \
  --server-side-encryption AES256

# Restore from backup
BACKUP_VALUE=$(gpg --decrypt ecdsa-key-backup-20260225.txt.gpg)
aws secretsmanager create-secret \
  --name vouch/production/ecdsa-private-key-restored \
  --secret-string "$BACKUP_VALUE" \
  --region us-east-1
```

## Delete Secrets (Caution!)

```bash
# Schedule deletion (30-day recovery window)
aws secretsmanager delete-secret \
  --secret-id vouch/staging/old-key \
  --recovery-window-in-days 30 \
  --region us-east-1

# Immediate deletion (no recovery!)
aws secretsmanager delete-secret \
  --secret-id vouch/staging/old-key \
  --force-delete-without-recovery \
  --region us-east-1

# Cancel scheduled deletion
aws secretsmanager restore-secret \
  --secret-id vouch/staging/old-key \
  --region us-east-1

# List secrets pending deletion
aws secretsmanager list-secrets \
  --filters Key=name,Values=vouch/ \
  --region us-east-1 \
  --query 'SecretList[?DeletedDate!=null]'
```

## Cost Estimation

```bash
# Count active secrets
aws secretsmanager list-secrets \
  --filters Key=name,Values=vouch/ \
  --region us-east-1 \
  --query 'length(SecretList)'

# Cost = $0.40/month per secret + $0.05 per 10,000 API calls

# Example:
# 3 secrets × $0.40 = $1.20/month
# 5,000 calls/month × $0.05/10,000 = $0.025/month
# Total: ~$1.23/month
```

## Troubleshooting

```bash
# Test IAM permissions
aws secretsmanager get-secret-value \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 \
  --dry-run 2>&1 | grep -q AccessDenied && echo "❌ Access Denied" || echo "✅ Access OK"

# Verify secret exists
aws secretsmanager describe-secret \
  --secret-id vouch/production/ecdsa-private-key \
  --region us-east-1 2>&1 | grep -q ResourceNotFoundException && echo "❌ Not Found" || echo "✅ Exists"

# Check service quota
aws service-quotas get-service-quota \
  --service-code secretsmanager \
  --quota-code L-6B622864 \
  --region us-east-1

# Get account ID (for ARN construction)
aws sts get-caller-identity --query 'Account' --output text
```

## Automated Scripts

### Rotate All Keys

```bash
#!/bin/bash
# rotate-all-keys.sh

set -e

SECRETS=(
  "vouch/production/deployer-private-key"
  "vouch/production/ecdsa-private-key"
  "vouch/production/encryption-key"
)

for SECRET in "${SECRETS[@]}"; do
  echo "Rotating $SECRET..."
  
  # Generate new key
  NEW_KEY=$(openssl rand -hex 32)
  
  # Update secret
  aws secretsmanager update-secret \
    --secret-id "$SECRET" \
    --secret-string "$NEW_KEY" \
    --description "Rotated on $(date)" \
    --region us-east-1
  
  echo "✓ $SECRET rotated"
done

echo "All keys rotated. Restart services to load new keys."
```

### Audit All Access

```bash
#!/bin/bash
# audit-secret-access.sh

SECRETS=(
  "vouch/production/deployer-private-key"
  "vouch/production/ecdsa-private-key"
  "vouch/production/encryption-key"
)

for SECRET in "${SECRETS[@]}"; do
  echo "=== $SECRET ==="
  
  aws cloudtrail lookup-events \
    --lookup-attributes AttributeKey=ResourceName,AttributeValue="$SECRET" \
    --start-time $(date -u -d '7 days ago' +%s) \
    --region us-east-1 \
    --query 'Events[*].[CloudTrailEvent]' \
    --output text | jq -r '.eventTime, .sourceIPAddress, .userIdentity.principalId' | head -20
  
  echo ""
done
```

## Reference

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [AWS CLI Secrets Manager Reference](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/secretsmanager/index.html)
- [CloudTrail Event Reference](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference.html)
- [IAM Policy Examples](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_examples.html)
