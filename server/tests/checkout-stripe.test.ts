import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import { createStripeGateway } from '../src/checkout/stripe.js';
import type { Order } from '../src/checkout/model.js';
import { startCheckoutWatcher } from '../src/checkout/watcher.js';

const order: Order = {
  id: '11111111-1111-4111-8111-111111111111', item_id: 'item', user_id: 'user', offer_id: 'offer',
  watch_id: 'watch', request_id: 'request', mode: 'autobuy', customer_id: 'cus_fixture',
  payment_method_id: 'pm_saved', merchant: 'Cedar Electronics', title: 'Headphones', amount_cents: 18500,
  currency: 'usd', stripe_payment_intent_id: null, status: 'creating', paid_amount_cents: null,
  failure_code: null, created_at: new Date().toISOString(),
};
const payment = { object: 'payment_intent', id: 'pi_fixture', livemode: false, customer: 'cus_fixture',
  amount: 18500, amount_received: 18500, currency: 'usd', status: 'succeeded',
  metadata: { midas_order_id: order.id }, client_secret: 'pi_fixture_secret' };

test('Stripe SDK sends card-only setup and exact off-session amount with stable idempotency keys', async () => {
  const calls: Array<{ url: string; body: URLSearchParams; headers: Headers }> = [];
  const stripe = new Stripe('sk_test_fixture', { maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')), headers: new Headers(init?.headers) });
      const object = url.endsWith('/setup_intents')
        ? { id: 'seti_fixture', livemode: false, customer: 'cus_fixture', status: 'requires_payment_method',
          metadata: { midas_user_id: 'user', consent_version: 'sandbox-autobuy-v1' }, client_secret: 'seti_secret' }
        : payment;
      return new Response(JSON.stringify(object), { status: 200 });
    }),
  });
  const gateway = createStripeGateway('sk_test_fixture', 'whsec_fixture', stripe);
  await gateway.createSetup('user', 'cus_fixture', 'request');
  await gateway.createPayment(order);
  await gateway.createPayment(order);
  assert.equal(calls[0]!.body.get('usage'), 'off_session');
  assert.equal(calls[0]!.body.get('allowed_payment_method_types[0]'), 'card');
  assert.equal(calls[1]!.body.get('amount'), '18500');
  assert.equal(calls[1]!.body.get('off_session'), 'true');
  assert.equal(calls[1]!.body.get('confirm'), 'true');
  assert.equal(calls[1]!.body.get('payment_method'), 'pm_saved');
  assert.equal(calls[1]!.headers.get('Idempotency-Key'), calls[2]!.headers.get('Idempotency-Key'));
  await gateway.createPayment({ ...order, mode: 'buy_now' });
  assert.equal(calls[3]!.body.has('confirm'), false, 'Buy Now is confirmed by PaymentSheet');
  assert.equal(calls[3]!.body.has('setup_future_usage'), false, 'Buy Now does not silently authorize autobuy');
});

test('Stripe decline carrying a PaymentIntent preserves that intent for recovery', async () => {
  let requests = 0;
  const stripe = new Stripe('sk_test_fixture', { maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (_input, init) => {
      requests++;
      return init?.method === 'POST'
        ? new Response(JSON.stringify({ error: { type: 'card_error', code: 'authentication_required',
          payment_intent: { ...payment, status: 'requires_action' } } }), { status: 402 })
        : new Response(JSON.stringify({ ...payment, status: 'requires_action', amount_received: 0 }), { status: 200 });
    }),
  });
  const result = await createStripeGateway('sk_test_fixture', 'whsec_fixture', stripe).createPayment(order);
  assert.equal(result.id, 'pi_fixture');
  assert.equal(result.status, 'requires_action');
  assert.equal(requests, 2);
});

test('real Stripe signature verification rejects tampering, stale signatures, and live events', () => {
  const stripe = new Stripe('sk_test_fixture');
  const gateway = createStripeGateway('sk_test_fixture', 'whsec_fixture', stripe);
  const sign = (payload: string, timestamp?: number) => stripe.webhooks.generateTestHeaderString({
    payload, secret: 'whsec_fixture', timestamp,
  });
  const payload = JSON.stringify({ id: 'evt_fixture', livemode: false, type: 'payment_intent.succeeded',
    data: { object: payment } });
  assert.equal(gateway.verifyWebhook(Buffer.from(payload), sign(payload)).objectId, 'pi_fixture');
  assert.throws(() => gateway.verifyWebhook(Buffer.from(`${payload} `), sign(payload)), { code: 'invalid_webhook_signature' });
  assert.throws(() => gateway.verifyWebhook(Buffer.from(payload), sign(payload, 1)), { code: 'invalid_webhook_signature' });
  const live = payload.replace('"livemode":false', '"livemode":true');
  assert.throws(() => gateway.verifyWebhook(Buffer.from(live), sign(live)), { code: 'live_mode_forbidden' });
  assert.throws(() => createStripeGateway('sk_live_forbidden', 'whsec_fixture'), { code: 'sandbox_key_required' });
});

test('live Stripe objects are rejected even behind an apparently test-mode client', async () => {
  const stripe = new Stripe('sk_test_fixture', { httpClient: Stripe.createFetchHttpClient(async () =>
    new Response(JSON.stringify({ ...payment, livemode: true }), { status: 200 })) });
  await assert.rejects(createStripeGateway('sk_test_fixture', 'whsec_fixture', stripe).retrievePayment('pi_fixture'),
    { code: 'live_mode_forbidden' });
});

test('watcher skips overlapping polls and shutdown waits for its in-flight pass', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  let resolve!: (value: { checked: number; errors: number }) => void;
  const stop = startCheckoutWatcher({ poll: async () => {
    calls++;
    return new Promise((done) => { resolve = done; });
  } });
  t.mock.timers.tick(30_000);
  assert.equal(calls, 1);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  resolve({ checked: 1, errors: 0 });
  await stopping;
  t.mock.timers.tick(30_000);
  assert.equal(calls, 1);
});
