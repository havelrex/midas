import { Router, raw, type RequestHandler } from 'express';
import { requireUser, type VerifyToken } from '../middleware/requireUser.js';
import { CheckoutError, CONSENT_TEXT, CONSENT_VERSION } from '../checkout/model.js';
import type { CheckoutService } from '../checkout/service.js';

function handle(action: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try { await action(req, res, next); }
    catch (error) {
      if (error instanceof CheckoutError) res.status(error.status).json({ error: error.message, code: error.code });
      else next(error);
    }
  };
}
function body(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))) {
    throw new CheckoutError(400, 'invalid_request');
  }
  return value;
}
export function checkoutRouter(verifyToken: VerifyToken, service?: CheckoutService) {
  const router = Router();
  router.use('/checkout', requireUser(verifyToken), (_req, res, next) => {
    if (!service) { res.status(503).json({ error: 'Sandbox checkout is not configured.', code: 'checkout_unavailable' }); return; }
    next();
  });
  router.get('/checkout/config', (_req, res) => res.json({
    sandbox: true, currency: 'usd', consentVersion: CONSENT_VERSION, consentText: CONSENT_TEXT,
  }));
  router.get('/checkout/items/:itemId', handle(async (req, res) => {
    res.json(await service!.item(req.userId!, req.params.itemId as string));
  }));
  router.post('/checkout/setup-intent', handle(async (req, res) => {
    body(req.body, ['requestId', 'consentVersion']);
    res.json(await service!.setup(req.userId!, req.body));
  }));
  router.post('/checkout/items/:itemId/payment-intent', handle(async (req, res) => {
    body(req.body, ['requestId', 'offerRevision']);
    res.json(await service!.buyNow(req.userId!, req.params.itemId as string, req.body));
  }));
  router.put('/checkout/items/:itemId/autobuy', handle(async (req, res) => {
    body(req.body, ['setupIntentId', 'thresholdCents', 'consentVersion']);
    res.json(await service!.setWatch(req.userId!, req.params.itemId as string, req.body));
  }));
  router.delete('/checkout/items/:itemId/autobuy', handle(async (req, res) => {
    res.json(await service!.cancelWatch(req.userId!, req.params.itemId as string));
  }));
  router.get('/checkout/orders/:orderId', handle(async (req, res) => {
    res.json(await service!.order(req.userId!, req.params.orderId as string));
  }));
  router.post('/checkout/orders/:orderId/resume', handle(async (req, res) => {
    res.json(await service!.resume(req.userId!, req.params.orderId as string));
  }));
  router.post('/checkout/orders/:orderId/cancel', handle(async (req, res) => {
    res.json(await service!.cancelOrder(req.userId!, req.params.orderId as string));
  }));
  return router;
}
export function stripeWebhookRouter(service?: CheckoutService) {
  const router = Router();
  router.post('/webhooks/stripe', raw({ type: 'application/json', limit: '1mb' }), handle(async (req, res) => {
    if (!service) throw new CheckoutError(503, 'checkout_unavailable');
    if (!Buffer.isBuffer(req.body) || typeof req.headers['stripe-signature'] !== 'string') {
      throw new CheckoutError(400, 'invalid_webhook_signature');
    }
    await service.webhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true });
  }));
  return router;
}
