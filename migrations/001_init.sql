-- VOUCH Database Schema v2.0
-- Run with: psql $DATABASE_URL -f migrations/001_init.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════
-- Table 1: users
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  tier VARCHAR(50) DEFAULT 'free'
    CHECK (tier IN ('free', 'starter', 'growth', 'enterprise')),
  monthly_proofs_limit INT DEFAULT 10,
  used_proofs_this_month INT DEFAULT 0,
  billing_cycle_start DATE DEFAULT CURRENT_DATE,
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════
-- Table 2: agents
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  api_key_prefix VARCHAR(16) NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  proof_nonce INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);

-- ═══════════════════════════════════════
-- Table 3: rules
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL,
  version INT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_agent_id ON rules(agent_id);

-- ═══════════════════════════════════════
-- Table 4: proofs
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  rule_id UUID NOT NULL REFERENCES rules(id),

  -- Input
  action_data JSONB NOT NULL,

  -- Evaluation
  evaluation JSONB NOT NULL,
  rule_met BOOLEAN NOT NULL,
  decision_summary VARCHAR(255),

  -- Cryptographic proof
  proof_hash VARCHAR(66) NOT NULL UNIQUE,
  signature_encrypted TEXT NOT NULL,
  nonce INT NOT NULL,

  -- On-chain (null until batched)
  on_chain_tx_hash VARCHAR(66),
  on_chain_batch_id UUID,

  -- Cost
  proof_cost DECIMAL(10, 6) DEFAULT 0.009900,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proofs_agent_id ON proofs(agent_id);
CREATE INDEX IF NOT EXISTS idx_proofs_rule_id ON proofs(rule_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proofs_hash ON proofs(proof_hash);
CREATE INDEX IF NOT EXISTS idx_proofs_created ON proofs(created_at DESC);

-- ═══════════════════════════════════════
-- Table 5: rules_history
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS rules_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id),
  version INT NOT NULL,
  conditions JSONB NOT NULL,
  changed_by UUID REFERENCES users(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_history_rule ON rules_history(rule_id, version);

-- ═══════════════════════════════════════
-- Table 6: billing
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  billing_month DATE NOT NULL,
  proofs_generated INT DEFAULT 0,
  proofs_on_chain INT DEFAULT 0,
  base_monthly DECIMAL(10, 2),
  overage_proofs INT DEFAULT 0,
  overage_cost DECIMAL(10, 2) DEFAULT 0,
  total_charged DECIMAL(10, 2),
  payment_status VARCHAR(50) DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'waived')),
  stripe_invoice_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, billing_month)
);

-- ═══════════════════════════════════════
-- Updated_at trigger
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rules_updated_at BEFORE UPDATE ON rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER billing_updated_at BEFORE UPDATE ON billing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
