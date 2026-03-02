// ═══════════════════════════════════════════
// Billing Routes
// Checkout, webhooks, and portal management
// ═══════════════════════════════════════════

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireJwt } from '../middleware/auth';
import { createCheckoutSession, handleWebhookEvent, getBillingPortalLink } from '../services/stripe';

export default async function billingRoutes(app: FastifyInstance) {

  // ─── POST /api/billing/checkout ────────
  // Create a Stripe checkout session for subscription upgrade
  app.post('/api/billing/checkout', { preHandler: [requireJwt] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (req as any).user;
      const body = req.body as any;

      if (!body || !body.tier) {
        return reply.code(400).send({
          error: 'tier is required',
          code: 'VALIDATION_ERROR',
        });
      }

      const validTiers = ['pro', 'growth', 'enterprise'];
      if (!validTiers.includes(body.tier)) {
        return reply.code(400).send({
          error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
          code: 'VALIDATION_ERROR',
        });
      }

      const result = await createCheckoutSession(user.sub, body.tier);

      return reply.code(200).send({
        session_id: result.session_id,
        checkoutUrl: result.checkoutUrl,
      });

    } catch (err: any) {
      console.error('[billing] POST /checkout error:', err.message);
      return reply.code(500).send({
        error: err.message || 'Failed to create checkout session',
        code: 'STRIPE_ERROR',
      });
    }
  });

  // ─── POST /api/billing/webhook ────────
  // Handle Stripe webhook events
  // Public route (no auth), raw body required for signature verification
  app.post('/api/billing/webhook', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      // Fastify needs raw body for Stripe signature verification
      // This is typically handled by a bodyParser plugin, but for webhooks
      // we need to access the raw buffer
      req.rawBody = await req.getRawBody?.() || Buffer.alloc(0);
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        return reply.code(400).send({
          error: 'Missing stripe-signature header',
          code: 'INVALID_SIGNATURE',
        });
      }

      const rawBody = (req as any).rawBody?.toString() || '';
      const result = await handleWebhookEvent(signature, rawBody);

      return reply.code(200).send(result);

    } catch (err: any) {
      console.error('[billing] POST /webhook error:', err.message);
      return reply.code(400).send({
        error: err.message || 'Webhook processing failed',
        code: 'WEBHOOK_ERROR',
      });
    }
  });

  // ─── GET /api/billing/portal ──────────
  // Get link to Stripe billing portal
  app.get('/api/billing/portal', { preHandler: [requireJwt] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (req as any).user;
      const result = await getBillingPortalLink(user.sub);

      return reply.code(200).send({
        portalUrl: result.portalUrl,
      });

    } catch (err: any) {
      console.error('[billing] GET /portal error:', err.message);
      return reply.code(500).send({
        error: err.message || 'Failed to create portal link',
        code: 'STRIPE_ERROR',
      });
    }
  });
}
