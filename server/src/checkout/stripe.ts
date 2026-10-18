import Stripe from 'stripe';
import { CheckoutError, CONSENT_VERSION, type Order } from './model.js';
import type { PaymentStatus } from './contracts.js';

export interface Payment {
  id: string; customer: string; amount: number; paid: number; currency: string;
  status: Exclude<PaymentStatus, 'creating'>; clientSecret: string | null;
  orderId: string; failureCode: string | null;
}
export interface Setup {
  id: string; customer: string; userId: string; consentVersion: string;
  paymentMethod: string | null; status: string; clientSecret: string | null;
}
export interface StripeEvent { id: string; type: string; objectId: string }
export interface PaymentGateway {
  createCustomer(userId: string, creationId: string): Promise<string>;
  customerSession(customerId: string): Promise<string>;
  createSetup(userId: string, customerId: string, requestId: string): Promise<Setup>;
  retrieveSetup(id: string): Promise<Setup>;
  createPayment(order: Order): Promise<Payment>;
  retrievePayment(id: string): Promise<Payment>;
  cancelPayment(id: string): Promise<Payment>;
  verifyWebhook(body: Buffer, signature: string): StripeEvent;
}

function sandbox(value: { livemode: boolean }): void {
  if (value.livemode !== false) throw new CheckoutError(400, 'live_mode_forbidden');
}
function id(value: string | { id: string } | null): string {
  return typeof value === 'string' ? value : value?.id ?? '';
}
function payment(value: Stripe.PaymentIntent): Payment {
  sandbox(value);
  if (!['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'canceled']
    .includes(value.status)) throw new CheckoutError(409, 'unexpected_payment_status');
  return { id: value.id, customer: id(value.customer), amount: value.amount, paid: value.amount_received,
    currency: value.currency, status: value.status as Payment['status'], clientSecret: value.client_secret,
    orderId: value.metadata.midas_order_id ?? '',
    failureCode: value.last_payment_error?.decline_code ?? value.last_payment_error?.code ?? null };
}
function setup(value: Stripe.SetupIntent): Setup {
  sandbox(value);
  return { id: value.id, customer: id(value.customer), userId: value.metadata?.midas_user_id ?? '',
    consentVersion: value.metadata?.consent_version ?? '', paymentMethod: id(value.payment_method) || null,
    status: value.status, clientSecret: value.client_secret };
}

export function createStripeGateway(secret: string, webhookSecret: string, client?: Stripe): PaymentGateway {
  if (!secret.startsWith('sk_test_')) throw new CheckoutError(503, 'sandbox_key_required');
  // The SDK pins its API version. The webhook is a notification; retrieve current
  // objects using this same version rather than relying on event payload versions.
  const stripe = client ?? new Stripe(secret, { maxNetworkRetries: 2, timeout: 15_000 });
  return {
    async createCustomer(userId, creationId) {
      const customer = await stripe.customers.create({ metadata: { midas_user_id: userId } },
        { idempotencyKey: `midas:customer:${creationId}` });
      sandbox(customer);
      return customer.id;
    },
    async customerSession(customerId) {
      const session = await stripe.customerSessions.create({ customer: customerId, components: {
        mobile_payment_element: { enabled: true, features: {
          payment_method_redisplay: 'enabled', payment_method_remove: 'disabled', payment_method_save: 'disabled',
        } },
      } });
      sandbox(session);
      return session.client_secret;
    },
    async createSetup(userId, customerId, requestId) {
      return setup(await stripe.setupIntents.create({ customer: customerId, usage: 'off_session',
        allowed_payment_method_types: ['card'], metadata: { midas_user_id: userId, consent_version: CONSENT_VERSION },
      }, { idempotencyKey: `midas:setup:${userId}:${requestId}` }));
    },
    async retrieveSetup(setupId) { return setup(await stripe.setupIntents.retrieve(setupId)); },
    async createPayment(order) {
      try {
        return payment(await stripe.paymentIntents.create({ amount: order.amount_cents, currency: order.currency,
          customer: order.customer_id, allowed_payment_method_types: ['card'],
          description: `${order.merchant}: ${order.title}`,
          metadata: { midas_order_id: order.id, midas_user_id: order.user_id, mode: order.mode },
          ...(order.mode === 'autobuy'
            ? { payment_method: order.payment_method_id!, off_session: true, confirm: true } : {}),
        }, { idempotencyKey: `midas:payment:${order.id}` }));
      } catch (error) {
        // Off-session authentication/decline errors can still contain a created
        // intent. Preserve it and recover the same payment, never create another.
        if (error instanceof Stripe.errors.StripeError && error.payment_intent) {
          return payment(await stripe.paymentIntents.retrieve(error.payment_intent.id));
        }
        throw error;
      }
    },
    async retrievePayment(paymentId) { return payment(await stripe.paymentIntents.retrieve(paymentId)); },
    async cancelPayment(paymentId) {
      try {
        return payment(await stripe.paymentIntents.cancel(paymentId, {},
          { idempotencyKey: `midas:cancel:${paymentId}` }));
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError && error.code === 'payment_intent_unexpected_state') {
          const current = payment(await stripe.paymentIntents.retrieve(paymentId));
          if (['succeeded', 'canceled'].includes(current.status)) return current;
          throw new CheckoutError(409, 'payment_in_progress', 'Stripe cannot cancel this payment in its current state.');
        }
        throw error;
      }
    },
    verifyWebhook(body, signature) {
      let event: Stripe.Event;
      try { event = stripe.webhooks.constructEvent(body, signature, webhookSecret); }
      catch { throw new CheckoutError(400, 'invalid_webhook_signature'); }
      sandbox(event);
      const object = event.data.object;
      return { id: event.id, type: event.type, objectId: 'id' in object ? object.id : '' };
    },
  };
}
