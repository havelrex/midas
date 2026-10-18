// Public checkout API types. Pure types, also re-exported by shared/checkout.ts.
export type PaymentStatus = 'creating' | 'requires_payment_method' | 'requires_confirmation'
  | 'requires_action' | 'processing' | 'succeeded' | 'canceled';
export type WatchState = 'active' | 'charging' | 'paused' | 'purchased' | 'canceled';
export interface SandboxQuote {
  offerId: string; revision: number; merchant: string; title: string;
  priceCents: number; shippingCents: number; totalCents: number; currency: 'usd';
}
export interface WatchSummary {
  id: string; state: WatchState; thresholdCents: number; consentVersion: string;
}
export interface OrderSummary {
  id: string; itemId: string | null; mode: 'buy_now' | 'autobuy'; status: PaymentStatus;
  amountCents: number; paidAmountCents: number | null; currency: 'usd'; merchant: string;
  failureCode: string | null;
}
export interface ItemCheckout {
  eligible: boolean; reason: 'unsupported_retailer' | null; quote: SandboxQuote | null;
  watch: WatchSummary | null; order: OrderSummary | null;
}
export interface PaymentSheetConfig {
  publishableKey: string; merchantDisplayName: string; customerId: string;
  customerSessionClientSecret: string;
  paymentIntentClientSecret?: string;
  setupIntentClientSecret?: string;
  setupIntentId?: string;
  order?: OrderSummary;
}
export interface BuyNowRequest { requestId: string; offerRevision: number }
export interface SetupCardRequest { requestId: string; consentVersion: 'sandbox-autobuy-v1' }
export interface AutobuyRequest {
  setupIntentId: string; thresholdCents: number; consentVersion: 'sandbox-autobuy-v1';
}
