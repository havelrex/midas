import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckoutError, type Customer } from './model.js';

export type Table = 'items' | 'checkout_customers' | 'checkout_offers' | 'checkout_watches'
  | 'checkout_orders' | 'checkout_webhook_events';
export type Rpc = 'checkout_claim' | 'checkout_set_watch' | 'checkout_cancel_watch'
  | 'checkout_apply_payment' | 'checkout_register_offer';
export type Filters = Record<string, string | string[]>;
export interface CheckoutStore {
  one<T>(table: Table, filters: Filters): Promise<T | null>;
  rows<T>(table: Table, filters?: Filters): Promise<T[]>;
  rpc<T>(name: Rpc, args: Record<string, unknown>): Promise<T>;
  ensureCustomer(userId: string): Promise<Customer>;
  saveCustomer(userId: string, customerId: string): Promise<void>;
  recordEvent(eventId: string): Promise<void>;
}
const errors: Record<string, number> = {
  item_not_found: 404, order_not_found: 404, unsupported_retailer: 409,
  payment_in_progress: 409, request_id_conflict: 409, quote_changed: 409,
  cancel_watch_first: 409, payment_mismatch: 409,
};
export function databaseError(error: { message: string; code?: string }): never {
  if (errors[error.message]) throw new CheckoutError(errors[error.message]!, error.message);
  if (error.code === '23505') throw new CheckoutError(409, 'payment_in_progress');
  throw new CheckoutError(503, 'checkout_storage_unavailable');
}
export function createCheckoutStore(db: SupabaseClient): CheckoutStore {
  const query = (table: Table, filters: Filters = {}) => {
    let request = db.from(table).select('*');
    for (const [key, value] of Object.entries(filters)) {
      request = Array.isArray(value) ? request.in(key, value) : request.eq(key, value);
    }
    return request;
  };
  return {
    async one<T>(table: Table, filters: Filters) {
      const { data, error } = await query(table, filters).maybeSingle();
      if (error) databaseError(error);
      return data as T | null;
    },
    async rows<T>(table: Table, filters: Filters = {}) {
      const { data, error } = await query(table, filters).order('id').limit(1000);
      if (error) databaseError(error);
      return (data ?? []) as T[];
    },
    async rpc<T>(name: Rpc, args: Record<string, unknown>) {
      const { data, error } = await db.rpc(name, args);
      if (error) databaseError(error);
      return data as T;
    },
    async ensureCustomer(userId: string) {
      const { error } = await db.from('checkout_customers').upsert({ user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: true });
      if (error) databaseError(error);
      const { data, error: readError } = await db.from('checkout_customers').select('*').eq('user_id', userId).single();
      if (readError) databaseError(readError);
      return data as Customer;
    },
    async saveCustomer(userId: string, customerId: string) {
      const { error } = await db.from('checkout_customers').update({ stripe_customer_id: customerId })
        .eq('user_id', userId).is('stripe_customer_id', null);
      if (error) databaseError(error);
    },
    async recordEvent(eventId: string) {
      const { error } = await db.from('checkout_webhook_events').upsert({ id: eventId },
        { onConflict: 'id', ignoreDuplicates: true });
      if (error) databaseError(error);
    },
  };
}
