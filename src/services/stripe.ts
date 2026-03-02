// ═══════════════════════════════════════════
// Stripe Service
// Handles checkout sessions, webhooks, and billing updates
// ═══════════════════════════════════════════

import Stripe from 'stripe';
import { query, queryOne, transaction } from '../db';

// Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10',
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Tier to Stripe price mapping
const STRIPE_PRICE_MAP: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || '',
  growth: process.env.STRIPE_PRICE_GROWTH || '',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || '',
};

// Tier metadata
const TIER_CONFIG: Record<string, { limit: number }> = {
  starter: { limit: 1000 },
  growth: { limit: 10000 },
  enterprise: { limit: 100000 },
};

// ─── Create Checkout Session ────────────

export async function createCheckoutSession(userId: string, tier: 'pro' | 'growth' | 'enterprise') {
  if (!STRIPE_PRICE_MAP[tier]) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  // Get or create Stripe customer
  const user = await queryOne<{ stripe_customer_id: string | null; email: string }>(
    `SELECT stripe_customer_id, email FROM users WHERE id = $1`,
    [userId]
  );

  if (!user) {
    throw new Error('User not found');
  }

  let customerId = user.stripe_customer_id;

  if (!customerId) {
    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        user_id: userId,
      },
    });
    customerId = customer.id;

    // Store customer ID
    await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customerId, userId]);
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: STRIPE_PRICE_MAP[tier],
        quantity: 1,
      },
    ],
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/pricing`,
    metadata: {
      user_id: userId,
      tier,
    },
  });

  if (!session.url) {
    throw new Error('Failed to generate checkout URL');
  }

  return {
    session_id: session.id,
    checkoutUrl: session.url,
  };
}

// ─── Handle Webhook Events ─────────────────

export async function handleWebhookEvent(signature: string, rawBody: string) {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err: any) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  // Process checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    await handleCheckoutCompleted(session);
  }

  // Process customer.subscription.updated
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;
    await handleSubscriptionUpdated(subscription);
  }

  // Process invoice.paid
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    await handleInvoicePaid(invoice);
  }

  return { received: true };
}

// ─── Handle Checkout Completed ──────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  const tier = session.metadata?.tier;

  if (!userId || !tier) {
    console.error('[stripe] Missing metadata in checkout session');
    return;
  }

  const config = TIER_CONFIG[tier];
  if (!config) {
    console.error(`[stripe] Invalid tier in checkout: ${tier}`);
    return;
  }

  await transaction(async (client) => {
    // Update user tier and monthly limit
    await client.query(
      `UPDATE users
       SET tier = $1, monthly_proofs_limit = $2, updated_at = NOW()
       WHERE id = $3`,
      [tier, config.limit, userId]
    );

    // Record in billing table
    await client.query(
      `INSERT INTO billing (user_id, billing_month, proofs_generated, proofs_on_chain, base_monthly, payment_status, stripe_invoice_id)
       VALUES ($1, CURRENT_DATE, 0, 0, 0, 'paid', $2)
       ON CONFLICT (user_id, billing_month) DO UPDATE
       SET payment_status = 'paid', stripe_invoice_id = $2, updated_at = NOW()`,
      [userId, session.id]
    );
  });

  console.log(`[stripe] Checkout completed for user ${userId}, tier: ${tier}`);
}

// ─── Handle Subscription Updated ────────

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Get user by customer ID
  const user = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE stripe_customer_id = $1`,
    [customerId]
  );

  if (!user) {
    console.error('[stripe] User not found for customer:', customerId);
    return;
  }

  // Check subscription status
  if (subscription.status === 'active' && subscription.items.data[0]) {
    const priceId = subscription.items.data[0].price.id;

    // Find matching tier
    let tier = 'pro';
    for (const [tierName, priceId_] of Object.entries(STRIPE_PRICE_MAP)) {
      if (priceId_ === priceId) {
        tier = tierName;
        break;
      }
    }

    const config = TIER_CONFIG[tier];
    if (!config) {
      console.error(`[stripe] No config for tier: ${tier}`);
      return;
    }

    await query(
      `UPDATE users
       SET tier = $1, monthly_proofs_limit = $2, updated_at = NOW()
       WHERE id = $3`,
      [tier, config.limit, user.id]
    );

    console.log(`[stripe] Subscription updated for user ${user.id}, tier: ${tier}`);
  }
}

// ─── Handle Invoice Paid ────────────────

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const user = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE stripe_customer_id = $1`,
    [customerId]
  );

  if (!user) {
    return;
  }

  // Update billing record
  await query(
    `INSERT INTO billing (user_id, billing_month, proofs_generated, proofs_on_chain, base_monthly, payment_status, stripe_invoice_id)
     VALUES ($1, $2, 0, 0, $3, 'paid', $4)
     ON CONFLICT (user_id, billing_month) DO UPDATE
     SET payment_status = 'paid', stripe_invoice_id = $4, updated_at = NOW()`,
    [
      user.id,
      new Date(invoice.period_start * 1000).toISOString().split('T')[0],
      invoice.amount_paid / 100,
      invoice.id,
    ]
  );

  console.log(`[stripe] Invoice paid for user ${user.id}`);
}

// ─── Get Billing Portal Link ─────────────

export async function getBillingPortalLink(userId: string) {
  const user = await queryOne<{ stripe_customer_id: string }>(
    `SELECT stripe_customer_id FROM users WHERE id = $1`,
    [userId]
  );

  if (!user || !user.stripe_customer_id) {
    throw new Error('No Stripe customer found');
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard`,
  });

  return {
    portalUrl: portal.url,
  };
}
