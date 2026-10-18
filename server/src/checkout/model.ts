import type { OrderSummary, PaymentStatus, WatchState, WatchSummary } from './contracts.js';

export const CONSENT_VERSION = 'sandbox-autobuy-v1';
export const MERCHANT = 'Cedar Electronics';
export const CONSENT_TEXT = 'Save this test card for one automatic purchase of this item from Cedar Electronics '
  + 'when the total including shipping is at or below my chosen threshold. I can cancel before payment starts. '
  + 'This is a sandbox demonstration; no real money or goods are exchanged.';
export class CheckoutError extends Error {
  constructor(public status: number, public code: string, message: string = code.replaceAll('_', ' ')) {
    super(message);
  }
}
export interface Customer {
  user_id: string; creation_id: string; created_at: string; stripe_customer_id: string | null;
}
export interface Offer {
  id: string; item_id: string; merchant: string; title: string; price_cents: number;
  shipping_cents: number; currency: 'usd'; revision: number; active: boolean;
}
export interface Watch {
  id: string; item_id: string; user_id: string; offer_id: string; customer_id: string;
  payment_method_id: string; setup_intent_id: string; threshold_cents: number;
  consent_version: string; state: WatchState;
}
export interface Order {
  id: string; item_id: string | null; user_id: string; offer_id: string; watch_id: string | null;
  request_id: string; mode: 'buy_now' | 'autobuy'; customer_id: string; payment_method_id: string | null;
  merchant: string; title: string; amount_cents: number; currency: 'usd';
  stripe_payment_intent_id: string | null; status: PaymentStatus; paid_amount_cents: number | null;
  failure_code: string | null; created_at: string;
}
export function orderSummary(order: Order): OrderSummary {
  return { id: order.id, itemId: order.item_id, mode: order.mode, status: order.status,
    amountCents: order.amount_cents, paidAmountCents: order.paid_amount_cents,
    currency: order.currency, merchant: order.merchant, failureCode: order.failure_code };
}
export function watchSummary(watch: Watch): WatchSummary {
  return { id: watch.id, state: watch.state, thresholdCents: watch.threshold_cents,
    consentVersion: watch.consent_version };
}
export function cents(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 50 || (value as number) > 99_999_999) {
    throw new CheckoutError(400, 'invalid_amount', 'Use integer USD cents between 50 and 99999999.');
  }
  return value as number;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new CheckoutError(400, 'invalid_id');
  }
  return value;
}
export function consent(value: unknown): void {
  if (value !== CONSENT_VERSION) throw new CheckoutError(400, 'consent_required');
}
