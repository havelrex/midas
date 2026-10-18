// Operator-only local commands. Never expose this module as an HTTP endpoint.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { loadConfig } from '../config/env.js';
import { createSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createCheckout } from './createCheckout.js';
import { CheckoutError, CONSENT_VERSION, MERCHANT, cents, uuid, type Offer, type Order } from './model.js';
import { createCheckoutStore } from './store.js';

async function main() {
  const config = loadConfig();
  const [command, identifier, price, shipping = '0'] = process.argv.slice(2);
  const db = createSupabaseAdmin(config);
  const store = createCheckoutStore(db);
  if (['demo', 'offer', 'price'].includes(command ?? '') && !config.demoMode) {
    throw new CheckoutError(400, 'demo_mode_required');
  }
  if (command === 'offer' || command === 'price') {
    const itemId = uuid(identifier);
    const item = await store.one<{ name: string }>('items', { id: itemId });
    if (!item) throw new CheckoutError(404, 'item_not_found');
    const existing = await store.one<Offer>('checkout_offers', { item_id: itemId });
    if (command === 'price' && !existing) throw new CheckoutError(404, 'offer_not_found');
    const priceCents = Number(price);
    const shippingCents = command === 'price' ? existing!.shipping_cents : Number(shipping);
    if (!price || !Number.isSafeInteger(priceCents) || priceCents < 0
      || !Number.isSafeInteger(shippingCents) || shippingCents < 0) throw new CheckoutError(400, 'invalid_amount');
    cents(priceCents + shippingCents);
    const offer = await store.rpc<Offer>('checkout_register_offer', { p_item: itemId,
      p_title: existing?.title ?? item.name, p_price: priceCents, p_shipping: shippingCents });
    console.info(JSON.stringify({ itemId, offerId: offer.id, revision: offer.revision,
      totalCents: offer.price_cents + offer.shipping_cents, message: 'Offer updated. The watcher runs separately.' }));
    return;
  }
  const checkout = createCheckout(config);
  if (!checkout) throw new CheckoutError(503, 'checkout_unavailable');
  if (command === 'reconcile') {
    const order = await store.one<Order>('checkout_orders', { id: uuid(identifier) });
    if (!order || !price || !/^pi_[a-zA-Z0-9]+$/.test(price)) throw new CheckoutError(400, 'invalid_reconciliation');
    console.info(JSON.stringify(await checkout.reconcileOrder(order.user_id, order.id, price), null, 2));
    return;
  }
  if (command === 'status') {
    const itemId = uuid(identifier);
    const item = await store.one<{ user_id: string }>('items', { id: itemId });
    if (!item) throw new CheckoutError(404, 'item_not_found');
    console.info(JSON.stringify(await checkout.item(item.user_id, itemId), null, 2));
    return;
  }
  if (command !== 'demo') {
    console.info('Usage: npm run checkout:demo -- demo USER_UUID | offer ITEM_UUID PRICE_CENTS SHIPPING_CENTS | price ITEM_UUID PRICE_CENTS | status ITEM_UUID | reconcile ORDER_UUID pi_INTENT');
    return;
  }
  const userId = uuid(identifier);
  // This script is the explicit test-card surrogate for the future PaymentSheet UI.
  const stripe = new Stripe(config.stripeSecretKey!);
  async function seed(name: string, priceCents: number) {
    const itemId = randomUUID();
    const sub = { value: 50, reason: 'Sandbox checkout fixture; not an algorithm score.' };
    const { error } = await db.from('items').insert({ id: itemId, user_id: userId, name,
      thumbnail_url: '', summary: 'Sandbox checkout fixture', category: 'electronics',
      brand: 'Demo', model: 'Fixture', score: 50, verdict: 'wait',
      subscores: { quality: sub, price: sub, reviews: sub, timing: sub },
      best_listing: { merchant: MERCHANT, price: priceCents / 100, shipping: 5, url: '' } });
    if (error) throw new CheckoutError(503, 'fixture_creation_failed', 'Could not create the fixture. Check the user ID and database migration.');
    const offer = await store.rpc<Offer>('checkout_register_offer', { p_item: itemId,
      p_title: name, p_price: priceCents, p_shipping: 500 });
    return { itemId, offer };
  }
  const setup = await checkout.setup(userId, { requestId: randomUUID(), consentVersion: CONSENT_VERSION });
  const saved = await stripe.setupIntents.confirm(setup.setupIntentId!, { payment_method: 'pm_card_visa' });
  if (saved.livemode || saved.status !== 'succeeded') throw new CheckoutError(409, 'test_card_setup_failed');
  const watch = await seed('Demo headphones — autobuy', 25900);
  await checkout.setWatch(userId, watch.itemId, { setupIntentId: saved.id,
    thresholdCents: 20000, consentVersion: CONSENT_VERSION });
  const buy = await seed('Demo headphones — Buy Now', 14900);
  const sheet = await checkout.buyNow(userId, buy.itemId, { requestId: randomUUID(), offerRevision: buy.offer.revision });
  const order = await store.one<{ stripe_payment_intent_id: string }>('checkout_orders', { id: sheet.order!.id });
  const paid = await stripe.paymentIntents.confirm(order!.stripe_payment_intent_id, { payment_method: 'pm_card_visa' });
  if (paid.livemode || paid.status !== 'succeeded') throw new CheckoutError(409, 'test_purchase_failed');
  console.info(JSON.stringify({ buyNow: await checkout.order(userId, sheet.order!.id),
    watchItemId: watch.itemId, targetCents: 20000, currentTotalCents: 26400,
    nextCommand: `npm run checkout:demo -- price ${watch.itemId} 18000`,
    expectedPaidCents: 18500,
    message: 'Keep the API running. Lowering the price will be detected on a subsequent watcher pass.' }, null, 2));
}
main().catch((error: unknown) => {
  // Stripe/DB errors may contain keys or client secrets; never print raw errors.
  console.error(error instanceof CheckoutError ? error.message : 'Sandbox command failed. Check server configuration and provider availability.');
  process.exitCode = 1;
});
