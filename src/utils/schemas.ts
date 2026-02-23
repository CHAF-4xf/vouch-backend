// ═══════════════════════════════════════════
// VOUCH Input Validation (Zod)
// ═══════════════════════════════════════════

import { z } from 'zod';

// ─── Auth ────────────────────────────────

export const SignupSchema = z.object({
  email: z.string().email('Invalid email').max(255),
  password: z.string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Password needs at least one uppercase letter')
    .regex(/[0-9]/, 'Password needs at least one number'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Agents ──────────────────────────────

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

// ─── Rules ───────────────────────────────

const ConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(['=', '!=', '<', '<=', '>', '>=', 'IN', 'NOT IN', 'CONTAINS', 'NOT CONTAINS']),
  value: z.any(),
});

export const CreateRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  conditions: z.array(ConditionSchema).min(1).max(20),
});

// ─── Prove ───────────────────────────────

export const ProveSchema = z.object({
  rule_id: z.string().uuid('Invalid rule_id format'),
  action_data: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.boolean(), z.array(z.any())])
  ).refine(
    (obj) => Object.keys(obj).length > 0 && Object.keys(obj).length <= 50,
    'action_data must have 1-50 fields'
  ),
});

// ─── Dashboard ───────────────────────────

export const ProofsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  rule_met: z.enum(['true', 'false']).optional(),
  agent_id: z.string().uuid().optional(),
});

// ─── Pricing ─────────────────────────────

export const PricingEstimateSchema = z.object({
  tier: z.enum(['free', 'starter', 'growth', 'enterprise']),
  monthly_proofs: z.coerce.number().int().min(0).max(1000000).default(0),
});
