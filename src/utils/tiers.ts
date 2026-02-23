// ═══════════════════════════════════════════
// VOUCH Pricing Tiers
// Matches landing page: $9.99 / $99 / Custom
// ═══════════════════════════════════════════

export interface TierConfig {
  name: string;
  display_name: string;
  base_fee: number;
  monthly_limit: number;
  overage_rate: number;   // per-proof cost beyond limit
  features: string[];
}

export const TIERS: Record<string, TierConfig> = {
  free: {
    name: 'free',
    display_name: 'Free',
    base_fee: 0,
    monthly_limit: 10,
    overage_rate: 0,       // hard cap, no overage
    features: [
      'API access',
      'Up to 10 proofs/month',
      'Basic dashboard',
    ],
  },

  starter: {
    name: 'starter',
    display_name: 'Starter',
    base_fee: 9.99,
    monthly_limit: 1000,
    overage_rate: 0.015,   // $0.015 per proof over 1K
    features: [
      'API access',
      '1,000 proofs/month',
      'Dashboard & analytics',
      'Email support',
    ],
  },

  growth: {
    name: 'growth',
    display_name: 'Growth',
    base_fee: 99.00,
    monthly_limit: 10000,
    overage_rate: 0.012,   // $0.012 per proof over 10K
    features: [
      'API access',
      '10,000 proofs/month',
      'Dashboard & analytics',
      'Custom guardrails',
      'Webhook integrations',
      'Priority support',
    ],
  },

  enterprise: {
    name: 'enterprise',
    display_name: 'Enterprise',
    base_fee: 0,           // custom pricing
    monthly_limit: 100000, // default, negotiated
    overage_rate: 0,       // negotiated
    features: [
      'API access',
      '25K / 50K / 100K+ proofs/month',
      'Volume discounts',
      'Custom guardrails',
      'Webhook integrations',
      'Dedicated support',
      'SLA guarantee',
      'On-premise option',
    ],
  },
};

/**
 * Get the effective per-proof cost for a tier.
 */
export function effectiveCostPerProof(tier: string, proofCount: number): number {
  const t = TIERS[tier];
  if (!t || proofCount === 0) return 0;
  return t.base_fee / Math.min(proofCount, t.monthly_limit);
}

/**
 * Calculate estimated bill for a given tier and proof count.
 */
export function estimateBill(tier: string, monthlyProofs: number): {
  base_fee: number;
  proofs_included: number;
  overage_proofs: number;
  overage_cost: number;
  total: number;
  effective_cost_per_proof: string;
} {
  const t = TIERS[tier];
  if (!t) throw new Error(`Unknown tier: ${tier}`);

  const overageProofs = Math.max(0, monthlyProofs - t.monthly_limit);
  const overageCost = overageProofs * t.overage_rate;
  const total = t.base_fee + overageCost;
  const effectiveCost = monthlyProofs > 0 ? (total / monthlyProofs).toFixed(6) : '0';

  return {
    base_fee: t.base_fee,
    proofs_included: t.monthly_limit,
    overage_proofs: overageProofs,
    overage_cost: Math.round(overageCost * 100) / 100,
    total: Math.round(total * 100) / 100,
    effective_cost_per_proof: `$${effectiveCost}`,
  };
}
