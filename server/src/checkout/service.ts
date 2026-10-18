import type { AutobuyRequest, BuyNowRequest, ItemCheckout, PaymentSheetConfig, SetupCardRequest } from './contracts.js';
import { cents, CheckoutError, consent, CONSENT_VERSION, MERCHANT, orderSummary, uuid, watchSummary,
  type Customer, type Offer, type Order, type Watch } from './model.js';
import type { CheckoutStore } from './store.js';
import type { Payment, PaymentGateway } from './stripe.js';

// Stripe may prune idempotency records after 24h. An old unbound attempt needs
// operator reconciliation, not a blind retry that could create a second charge.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export class CheckoutService {
  constructor(private store: CheckoutStore, private gateway: PaymentGateway,
    private publishableKey: string, private now: () => number = Date.now) {}

  private async ownedItem(userId: string, itemId: string) {
    uuid(itemId);
    if (!await this.store.one('items', { id: itemId, user_id: userId })) {
      throw new CheckoutError(404, 'item_not_found');
    }
  }
  private async customer(userId: string): Promise<string> {
    const row = await this.store.ensureCustomer(userId);
    if (row.stripe_customer_id) return row.stripe_customer_id;
    this.assertRetryWindow(row.created_at);
    const customerId = await this.gateway.createCustomer(userId, row.creation_id);
    await this.store.saveCustomer(userId, customerId);
    return customerId;
  }
  private assertRetryWindow(createdAt: string) {
    if (this.now() - Date.parse(createdAt) >= RETRY_WINDOW_MS) {
      throw new CheckoutError(409, 'reconciliation_required', 'An earlier Stripe request needs operator reconciliation.');
    }
  }
  private async ownedOrder(userId: string, orderId: string) {
    uuid(orderId);
    const order = await this.store.one<Order>('checkout_orders', { id: orderId, user_id: userId });
    if (!order) throw new CheckoutError(404, 'order_not_found');
    return order;
  }
  private async sheet(customerId: string, merchant = MERCHANT): Promise<PaymentSheetConfig> {
    return { publishableKey: this.publishableKey, merchantDisplayName: merchant, customerId,
      customerSessionClientSecret: await this.gateway.customerSession(customerId) };
  }
  async item(userId: string, itemId: string): Promise<ItemCheckout> {
    await this.ownedItem(userId, itemId);
    const [offer, watch, orders] = await Promise.all([
      this.store.one<Offer>('checkout_offers', { item_id: itemId }),
      this.store.one<Watch>('checkout_watches', { item_id: itemId, user_id: userId }),
      this.store.rows<Order>('checkout_orders', { item_id: itemId, user_id: userId }),
    ]);
    const order = orders.find((o) => o.status !== 'canceled')
      ?? orders.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { eligible: !!offer?.active, reason: offer?.active ? null : 'unsupported_retailer',
      quote: offer?.active ? { offerId: offer.id, revision: offer.revision, merchant: offer.merchant,
        title: offer.title, priceCents: offer.price_cents, shippingCents: offer.shipping_cents,
        totalCents: offer.price_cents + offer.shipping_cents, currency: offer.currency } : null,
      watch: watch ? watchSummary(watch) : null, order: order ? orderSummary(order) : null };
  }
  async setup(userId: string, input: SetupCardRequest): Promise<PaymentSheetConfig> {
    uuid(input.requestId); consent(input.consentVersion);
    const customerId = await this.customer(userId);
    const setup = await this.gateway.createSetup(userId, customerId, input.requestId);
    if (!setup.clientSecret) throw new CheckoutError(502, 'setup_unavailable');
    return { ...await this.sheet(customerId), setupIntentId: setup.id, setupIntentClientSecret: setup.clientSecret };
  }
  async setWatch(userId: string, itemId: string, input: AutobuyRequest) {
    await this.ownedItem(userId, itemId);
    cents(input.thresholdCents); consent(input.consentVersion);
    if (typeof input.setupIntentId !== 'string' || !/^seti_[a-zA-Z0-9]+$/.test(input.setupIntentId)) {
      throw new CheckoutError(400, 'invalid_setup_intent');
    }
    const customer = await this.store.one<Customer>('checkout_customers', { user_id: userId });
    if (!customer?.stripe_customer_id) throw new CheckoutError(409, 'card_setup_required');
    const setup = await this.gateway.retrieveSetup(input.setupIntentId);
    if (setup.customer !== customer.stripe_customer_id || setup.userId !== userId
      || setup.consentVersion !== CONSENT_VERSION) throw new CheckoutError(403, 'invalid_card_owner');
    if (setup.status !== 'succeeded' || !setup.paymentMethod) throw new CheckoutError(409, 'card_setup_required');
    const watch = await this.store.rpc<Watch>('checkout_set_watch', { p_user: userId, p_item: itemId,
      p_setup: setup.id, p_customer: setup.customer, p_method: setup.paymentMethod,
      p_threshold: input.thresholdCents, p_consent: input.consentVersion });
    return watchSummary(watch);
  }
  async cancelWatch(userId: string, itemId: string) {
    uuid(itemId);
    await this.store.rpc('checkout_cancel_watch', { p_user: userId, p_item: itemId });
    return { canceled: true };
  }
  async buyNow(userId: string, itemId: string, input: BuyNowRequest): Promise<PaymentSheetConfig> {
    uuid(itemId); uuid(input.requestId);
    if (!Number.isSafeInteger(input.offerRevision) || input.offerRevision < 1) {
      throw new CheckoutError(400, 'invalid_offer_revision');
    }
    const state = await this.item(userId, itemId);
    if (!state.eligible) throw new CheckoutError(409, 'unsupported_retailer');
    const customerId = await this.customer(userId);
    const order = await this.store.rpc<Order>('checkout_claim', { p_user: userId, p_item: itemId,
      p_request: input.requestId, p_customer: customerId, p_revision: input.offerRevision });
    const payment = await this.ensurePayment(order);
    return this.paymentSheet(order, payment);
  }
  private async apply(order: Order, payment: Payment, eventId?: string) {
    if (payment.orderId !== order.id) throw new CheckoutError(409, 'payment_mismatch');
    await this.store.rpc('checkout_apply_payment', { p_order: order.id, p_intent: payment.id,
      p_status: payment.status, p_amount: payment.amount, p_paid: payment.paid,
      p_currency: payment.currency, p_customer: payment.customer, p_failure: payment.failureCode,
      p_event: eventId ?? null });
  }
  private async ensurePayment(order: Order): Promise<Payment> {
    let payment: Payment;
    if (order.stripe_payment_intent_id) payment = await this.gateway.retrievePayment(order.stripe_payment_intent_id);
    else {
      this.assertRetryWindow(order.created_at);
      payment = await this.gateway.createPayment(order);
      // Idempotent POST responses are snapshots. A later retry must not roll the
      // database backward if this intent has since succeeded or been canceled.
      payment = await this.gateway.retrievePayment(payment.id);
    }
    await this.apply(order, payment);
    return payment;
  }
  private async paymentSheet(order: Order, payment: Payment): Promise<PaymentSheetConfig> {
    const current = await this.ownedOrder(order.user_id, order.id);
    if (['succeeded', 'canceled', 'processing'].includes(current.status)) {
      throw new CheckoutError(409, 'payment_not_editable', `Payment is ${current.status}. Read the order status.`);
    }
    if (!payment.clientSecret) throw new CheckoutError(502, 'payment_unavailable');
    return { ...await this.sheet(order.customer_id, order.merchant),
      paymentIntentClientSecret: payment.clientSecret, order: orderSummary(current) };
  }
  async order(userId: string, orderId: string) {
    const order = await this.ownedOrder(userId, orderId);
    if (order.stripe_payment_intent_id && !['succeeded', 'canceled'].includes(order.status)) {
      await this.apply(order, await this.gateway.retrievePayment(order.stripe_payment_intent_id));
    }
    return orderSummary(await this.ownedOrder(userId, orderId));
  }
  async resume(userId: string, orderId: string) {
    const order = await this.ownedOrder(userId, orderId);
    return this.paymentSheet(order, await this.ensurePayment(order));
  }
  async cancelOrder(userId: string, orderId: string) {
    const order = await this.ownedOrder(userId, orderId);
    if (!order.stripe_payment_intent_id) throw new CheckoutError(409, 'reconciliation_required');
    const current = await this.gateway.retrievePayment(order.stripe_payment_intent_id);
    const payment = ['succeeded', 'canceled'].includes(current.status)
      ? current : await this.gateway.cancelPayment(current.id);
    await this.apply(order, payment);
    return orderSummary(await this.ownedOrder(userId, orderId));
  }
  // Operator-only recovery hook. Deliberately not exposed as an HTTP route.
  async reconcileOrder(userId: string, orderId: string, intentId: string) {
    const order = await this.ownedOrder(userId, orderId);
    const payment = await this.gateway.retrievePayment(intentId);
    await this.apply(order, payment);
    return orderSummary(await this.ownedOrder(userId, orderId));
  }
  async webhook(body: Buffer, signature: string) {
    const event = this.gateway.verifyWebhook(body, signature);
    if (await this.store.one('checkout_webhook_events', { id: event.id })) return;
    const paymentEvents = ['payment_intent.succeeded', 'payment_intent.payment_failed',
      'payment_intent.requires_action', 'payment_intent.processing', 'payment_intent.canceled'];
    if (paymentEvents.includes(event.type)) {
      const payment = await this.gateway.retrievePayment(event.objectId);
      if (!payment.orderId) { await this.store.recordEvent(event.id); return; }
      const order = await this.store.one<Order>('checkout_orders', { id: payment.orderId });
      if (!order) throw new CheckoutError(503, 'order_not_available');
      await this.apply(order, payment, event.id);
    } else {
      // A SetupIntent event alone never authorizes buying. PUT autobuy verifies
      // setup success and records the item-specific threshold/consent separately.
      if (event.type === 'setup_intent.succeeded') await this.gateway.retrieveSetup(event.objectId);
      await this.store.recordEvent(event.id);
    }
  }
  async poll(): Promise<{ checked: number; errors: number }> {
    let errors = 0;
    // Recover uncertain outcomes and missed webhooks first, without reconfirming
    // declined/action-required intents. Only initial idempotent creates repeat.
    const pending = await this.store.rows<Order>('checkout_orders', { status: ['creating', 'processing',
      'requires_action', 'requires_confirmation', 'requires_payment_method'] });
    for (const order of pending) {
      try { await this.ensurePayment(order); } catch { errors++; }
    }
    const watches = await this.store.rows<Watch>('checkout_watches', { state: 'active' });
    for (const watch of watches) {
      try {
        const order = await this.store.rpc<Order | null>('checkout_claim', { p_user: watch.user_id,
          p_item: watch.item_id, p_request: watch.id, p_customer: watch.customer_id, p_watch: watch.id });
        if (order?.id) await this.ensurePayment(order);
      } catch { errors++; }
    }
    return { checked: pending.length + watches.length, errors };
  }
}
