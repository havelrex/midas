import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { fixture, OTHER, USER } from './checkout-fixture.js';
import { createApp } from '../src/app.js';
import { CheckoutService } from '../src/checkout/service.js';
import { CONSENT_VERSION, type Order } from '../src/checkout/model.js';

test('Buy Now uses server quote, reuses an intent, and records actual paid amount', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  const input = { requestId: randomUUID(), offerRevision: 1 };
  const [first, second] = await Promise.all([f.service.buyNow(USER, id, input), f.service.buyNow(USER, id, input)]);
  assert.equal(first.order!.id, second.order!.id);
  assert.equal(first.order!.amountCents, 25500, 'client-editable best_listing.price is ignored');
  assert.equal(f.gateway.creates, 1);
  await assert.rejects(f.service.buyNow(USER, id, { ...input, requestId: randomUUID() }), { code: 'payment_in_progress' });
  const order = (await f.store.one<Order>('checkout_orders', { id: first.order!.id }))!;
  f.gateway.succeed(order.stripe_payment_intent_id!);
  const paid = await f.service.order(USER, order.id);
  assert.equal(paid.paidAmountCents, 25500);
  assert.equal((await f.store.one<{ checkout_status: string }>('items', { id }))!.checkout_status, 'purchased');
});

test('autobuy waits for shipping-inclusive threshold and the price command does not charge', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  await f.watch(id);
  assert.deepEqual(await f.service.poll(), { checked: 1, errors: 0 });
  assert.equal(f.gateway.creates, 0);
  await f.price(id, 19900); // $204 with shipping, still above $200.
  await f.service.poll();
  assert.equal(f.gateway.creates, 0);
  await f.price(id, 19500); // Exactly $200 with shipping.
  assert.equal(f.gateway.creates, 0);
  await Promise.all([f.service.poll(), f.service.poll()]);
  await f.service.poll();
  assert.equal(f.gateway.creates, 1);
  const state = await f.service.item(USER, id);
  assert.equal(state.order!.paidAmountCents, 20000);
  assert.equal(state.watch!.state, 'purchased');
});

test('restart recovers a lost Stripe response without charging again, below threshold pays current total', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  await f.watch(id);
  await f.price(id, 18000);
  f.gateway.loseResponse = true;
  assert.equal((await f.service.poll()).errors, 1);
  assert.equal(f.gateway.creates, 1);
  const restarted = new CheckoutService(f.store, f.gateway, 'pk_test_fixture');
  await restarted.poll();
  assert.equal(f.gateway.creates, 1);
  assert.equal((await restarted.item(USER, id)).order!.paidAmountCents, 18500);
});

test('declines pause autobuy and resume uses the same intent; cancel releases the claim', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  f.gateway.autoStatus = 'requires_payment_method';
  await f.watch(id, 26000);
  await f.service.poll();
  const state = await f.service.item(USER, id);
  assert.equal(state.watch!.state, 'paused');
  assert.equal(state.order!.failureCode, 'card_declined');
  const attempts = f.gateway.attempts;
  await f.service.poll(); await f.service.poll();
  assert.equal(f.gateway.attempts, attempts);
  const sheet = await f.service.resume(USER, state.order!.id);
  assert.equal(sheet.order!.id, state.order!.id);
  await assert.rejects(f.service.cancelWatch(USER, id), { code: 'payment_in_progress' });
  await f.service.cancelOrder(USER, state.order!.id);
  assert.equal((await f.service.item(USER, id)).watch!.state, 'canceled');
  await f.watch(id);
});

test('authentication-required payments stay paused until the same intent succeeds', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  f.gateway.autoStatus = 'requires_action';
  await f.watch(id, 26000);
  await f.service.poll();
  const state = await f.service.item(USER, id);
  assert.equal(state.watch!.state, 'paused');
  const order = (await f.store.one<Order>('checkout_orders', { id: state.order!.id }))!;
  f.gateway.succeed(order.stripe_payment_intent_id!);
  await f.service.poll();
  assert.equal((await f.service.item(USER, id)).watch!.state, 'purchased');
  assert.equal(f.gateway.creates, 1);
});

test('cancellation/deletion serialize with claims and successful receipts survive deletion', async (t) => {
  const f = await fixture(t);
  const before = await f.item();
  await f.watch(before.id, 26000);
  await f.service.cancelWatch(USER, before.id);
  await f.service.poll();
  assert.equal(f.gateway.creates, 0);
  const removed = await f.item();
  await f.watch(removed.id, 26000);
  await f.db.query('delete from items where id=$1', [removed.id]);
  await f.service.poll();
  assert.equal(f.gateway.creates, 0);
  const pending = await f.item();
  const sheet = await f.service.buyNow(USER, pending.id, { requestId: randomUUID(), offerRevision: 1 });
  await assert.rejects(f.db.query('delete from items where id=$1', [pending.id]), /payment_in_progress/);
  const order = (await f.store.one<Order>('checkout_orders', { id: sheet.order!.id }))!;
  f.gateway.succeed(order.stripe_payment_intent_id!);
  await f.service.order(USER, order.id);
  await f.db.query('delete from items where id=$1', [pending.id]);
  assert.equal((await f.service.order(USER, order.id)).itemId, null);
});

test('ownership, real-retailer exclusion, setup consent and stale quotes are enforced', async (t) => {
  const f = await fixture(t);
  const real = await f.item(false);
  const item = await f.item();
  await assert.rejects(f.service.item(OTHER, item.id), { code: 'item_not_found' });
  await assert.rejects(f.service.buyNow(USER, real.id, { requestId: randomUUID(), offerRevision: 1 }), { code: 'unsupported_retailer' });
  await f.price(item.id, 24000);
  await assert.rejects(f.service.buyNow(USER, item.id, { requestId: randomUUID(), offerRevision: 1 }), { code: 'quote_changed' });
  const setup = await f.service.setup(OTHER, { requestId: randomUUID(), consentVersion: CONSENT_VERSION });
  await assert.rejects(f.service.setWatch(USER, item.id, { setupIntentId: setup.setupIntentId!,
    thresholdCents: 10000, consentVersion: CONSENT_VERSION }), { code: 'invalid_card_owner' });
  await assert.rejects(f.service.setup(USER, { requestId: randomUUID(), consentVersion: '' as typeof CONSENT_VERSION }), { code: 'consent_required' });
  const ownSetup = await f.service.setup(USER, { requestId: randomUUID(), consentVersion: CONSENT_VERSION });
  for (const thresholdCents of [49, -1, 100.1, 100000000]) {
    await assert.rejects(f.service.setWatch(USER, item.id, { setupIntentId: ownSetup.setupIntentId!,
      thresholdCents, consentVersion: CONSENT_VERSION }), { code: 'invalid_amount' });
  }
  f.gateway.setups.get(ownSetup.setupIntentId!)!.status = 'requires_action';
  await assert.rejects(f.service.setWatch(USER, item.id, { setupIntentId: ownSetup.setupIntentId!,
    thresholdCents: 10000, consentVersion: CONSENT_VERSION }), { code: 'card_setup_required' });
  assert.equal(f.gateway.creates, 0);
});

test('unknown attempts beyond Stripe idempotency retention never create another payment', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  await f.watch(id, 26000);
  f.gateway.loseResponse = true;
  await f.service.poll();
  await f.db.exec("update checkout_orders set created_at = now() - interval '25 hours'");
  await f.service.poll();
  assert.equal(f.gateway.attempts, 1);
  assert.equal((await f.service.item(USER, id)).order!.status, 'creating');
  const [payment] = f.gateway.payments.values();
  await f.service.reconcileOrder(USER, payment!.orderId, payment!.id);
  assert.equal((await f.service.item(USER, id)).order!.status, 'succeeded');
});

test('raw webhook signatures, duplicate events, and stale events preserve successful payment', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  const sheet = await f.service.buyNow(USER, id, { requestId: randomUUID(), offerRevision: 1 });
  const order = (await f.store.one<Order>('checkout_orders', { id: sheet.order!.id }))!;
  f.gateway.succeed(order.stripe_payment_intent_id!);
  const app = createApp({ verifyToken: async () => USER, checkout: f.service });
  const event = { id: 'evt_success', type: 'payment_intent.succeeded', objectId: order.stripe_payment_intent_id };
  await request(app).post('/webhooks/stripe').set('Stripe-Signature', 'invalid').send(event).expect(400);
  for (let i = 0; i < 2; i++) {
    await request(app).post('/webhooks/stripe').set('Stripe-Signature', 'valid-signature').send(event).expect(200);
  }
  await request(app).post('/webhooks/stripe').set('Stripe-Signature', 'valid-signature')
    .send({ ...event, id: 'evt_old_failure', type: 'payment_intent.payment_failed' }).expect(200);
  assert.equal((await f.service.order(USER, order.id)).status, 'succeeded');
  assert.equal((await f.store.rows('checkout_webhook_events')).length, 2);
});

test('routes reject unauthenticated, cross-user and client-supplied prices; disabled checkout returns 503', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  const app = createApp({ verifyToken: async (token) => token === 'user' ? USER : OTHER, checkout: f.service });
  await request(app).get(`/checkout/items/${id}`).expect(401);
  await request(app).get(`/checkout/items/${id}`).set('Authorization', 'Bearer other').expect(404);
  await request(app).post(`/checkout/items/${id}/payment-intent`).set('Authorization', 'Bearer user')
    .send({ requestId: randomUUID(), offerRevision: 1, amountCents: 1 }).expect(400);
  await request(app).post('/checkout/setup-intent').set('Authorization', 'Bearer user').send({}).expect(400);
  const disabled = createApp({ verifyToken: async () => USER });
  await request(disabled).get('/checkout/config').set('Authorization', 'Bearer user').expect(503);
});

test('mismatched webhook payments cannot fulfill orders or consume event receipts', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  const sheet = await f.service.buyNow(USER, id, { requestId: randomUUID(), offerRevision: 1 });
  const order = (await f.store.one<Order>('checkout_orders', { id: sheet.order!.id }))!;
  const payment = f.gateway.payments.get(order.stripe_payment_intent_id!)!;
  f.gateway.succeed(payment.id);
  const event = Buffer.from(JSON.stringify({ id: 'evt_retry', type: 'payment_intent.succeeded', objectId: payment.id }));
  payment.amount = 1;
  await assert.rejects(f.service.webhook(event, 'valid-signature'), { code: 'payment_mismatch' });
  assert.equal(await f.store.one('checkout_webhook_events', { id: 'evt_retry' }), null);
  assert.equal((await f.store.one<Order>('checkout_orders', { id: order.id }))!.status, 'requires_payment_method');
  payment.amount = order.amount_cents;
  await f.service.webhook(event, 'valid-signature');
  assert.equal((await f.service.order(USER, order.id)).status, 'succeeded');
});

test('RLS and triggers block direct payment state changes while retaining normal library edits', async (t) => {
  const f = await fixture(t);
  const { id } = await f.item();
  const asUser = (sql: string) => f.db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
    return tx.query(sql, [id]);
  });
  await asUser("update items set name='Renamed' where id=$1");
  await assert.rejects(asUser("update items set checkout_status='purchased' where id=$1"), /payment_fields_read_only/);
  await assert.rejects(asUser('update items set target_price=1 where id=$1'), /payment_fields_read_only/);
  await assert.rejects(asUser('select * from checkout_orders where item_id=$1'), /permission denied/);
  await assert.rejects(asUser(`select checkout_cancel_watch('${USER}', $1)`), /permission denied/);
  await f.watch(id, 26000);
  await assert.rejects(f.service.buyNow(USER, id, { requestId: randomUUID(), offerRevision: 1 }), { code: 'cancel_watch_first' });
  await asUser('delete from items where id=$1');
  await f.service.poll();
  assert.equal(f.gateway.creates, 0);
});
