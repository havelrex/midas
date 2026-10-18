import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { databaseError, type CheckoutStore, type Filters, type Rpc, type Table } from '../src/checkout/store.js';
import { CheckoutError, CONSENT_VERSION, type Customer, type Offer, type Order } from '../src/checkout/model.js';
import type { Payment, PaymentGateway, Setup } from '../src/checkout/stripe.js';
import { CheckoutService } from '../src/checkout/service.js';

export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export class FakeStripe implements PaymentGateway {
  payments = new Map<string, Payment>();
  setups = new Map<string, Setup>();
  creates = 0;
  attempts = 0;
  loseResponse = false;
  autoStatus: Payment['status'] = 'succeeded';
  async createCustomer(userId: string) { return `cus_${userId.replaceAll('-', '')}`; }
  async customerSession() { return 'customer_session_secret'; }
  async createSetup(userId: string, customerId: string, requestId: string) {
    const id = `seti_${requestId.replaceAll('-', '')}`;
    const setup: Setup = { id, userId, customer: customerId, consentVersion: CONSENT_VERSION,
      paymentMethod: 'pm_saved', status: 'succeeded', clientSecret: `${id}_secret` };
    this.setups.set(id, setup);
    return setup;
  }
  async retrieveSetup(id: string) { return this.setups.get(id)!; }
  async createPayment(order: Order) {
    this.attempts++;
    const id = `pi_${order.id.replaceAll('-', '')}`;
    if (!this.payments.has(id)) {
      this.creates++;
      const status = order.mode === 'autobuy' ? this.autoStatus : 'requires_payment_method';
      this.payments.set(id, { id, customer: order.customer_id, amount: order.amount_cents,
        paid: status === 'succeeded' ? order.amount_cents : 0, currency: 'usd', status,
        clientSecret: `${id}_secret`, orderId: order.id,
        failureCode: order.mode === 'autobuy' && status === 'requires_payment_method' ? 'card_declined' : null });
    }
    if (this.loseResponse) { this.loseResponse = false; throw new Error('network timeout'); }
    return { ...this.payments.get(id)! };
  }
  async retrievePayment(id: string) { return { ...this.payments.get(id)! }; }
  async cancelPayment(id: string) {
    this.payments.get(id)!.status = 'canceled';
    return this.retrievePayment(id);
  }
  verifyWebhook(body: Buffer, signature: string) {
    if (signature !== 'valid-signature') throw new CheckoutError(400, 'invalid_webhook_signature');
    return JSON.parse(body.toString()) as { id: string; type: string; objectId: string };
  }
  succeed(id: string) {
    const payment = this.payments.get(id)!;
    Object.assign(payment, { status: 'succeeded', paid: payment.amount, failureCode: null });
  }
}

export async function fixture(t: TestContext) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema public, auth to anon, authenticated, service_role;
    insert into auth.users values ('${USER}'), ('${OTHER}');
  `);
  const items = await readFile(new URL('../../supabase/migrations/0001_items.sql', import.meta.url), 'utf8');
  await db.exec(items.split('-- Realtime:')[0]!);
  await db.exec('grant all on public.items to authenticated, service_role;');
  await db.exec(await readFile(new URL('../../supabase/migrations/0003_sandbox_checkout.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  const identifier = (value: string) => {
    if (!/^[a-z_]+$/.test(value)) throw new Error('unsafe test SQL identifier');
    return `"${value}"`;
  };
  const rows = async <T>(table: Table, filters: Filters = {}) => {
    const entries = Object.entries(filters);
    const where = entries.map(([key, value], i) => `${identifier(key)} ${Array.isArray(value)
      ? `= any($${i + 1}::text[])` : `= $${i + 1}`}`).join(' and ');
    const result = await db.query<T>(`select * from ${identifier(table)}${where ? ` where ${where}` : ''}`,
      entries.map(([, value]) => value));
    // PostgREST sends timestamps as JSON strings, unlike PGlite's native Date.
    return JSON.parse(JSON.stringify(result.rows)) as T[];
  };
  const store: CheckoutStore = {
    rows,
    async one<T>(table: Table, filters: Filters) { return (await rows<T>(table, filters))[0] ?? null; },
    async rpc<T>(name: Rpc, args: Record<string, unknown>) {
      const entries = Object.entries(args);
      try {
        const result = await db.query<{ value: T }>(`select to_jsonb(public.${identifier(name)}(${entries
          .map(([key], i) => `${identifier(key)} => $${i + 1}`).join(',')})) as value`, entries.map(([, value]) => value));
        return result.rows[0]!.value;
      } catch (error) { databaseError(error as { message: string; code?: string }); }
    },
    async ensureCustomer(userId) {
      await db.query('insert into checkout_customers(user_id) values($1) on conflict do nothing', [userId]);
      return (await rows<Customer>('checkout_customers', { user_id: userId }))[0]!;
    },
    async saveCustomer(userId, customerId) {
      await db.query('update checkout_customers set stripe_customer_id = $2 where user_id = $1 and stripe_customer_id is null',
        [userId, customerId]);
    },
    async recordEvent(eventId) {
      await db.query('insert into checkout_webhook_events(id) values($1) on conflict do nothing', [eventId]);
    },
  };
  const gateway = new FakeStripe();
  const service = new CheckoutService(store, gateway, 'pk_test_fixture');
  async function item(withOffer = true, owner = USER) {
    const id = randomUUID();
    await db.query(`insert into items(id,user_id,name,thumbnail_url,category,score,subscores,verdict,best_listing)
      values($1,$2,'Headphones','','electronics',50,'{}','wait','{"merchant":"Real retailer","price":1}')`, [id, owner]);
    const offer = withOffer ? await store.rpc<Offer>('checkout_register_offer', {
      p_item: id, p_title: 'Headphones', p_price: 25000, p_shipping: 500,
    }) : null;
    return { id, offer };
  }
  async function watch(itemId: string, thresholdCents = 20000) {
    const setup = await service.setup(USER, { requestId: randomUUID(), consentVersion: CONSENT_VERSION });
    return service.setWatch(USER, itemId, { setupIntentId: setup.setupIntentId!, thresholdCents,
      consentVersion: CONSENT_VERSION });
  }
  async function price(itemId: string, priceCents: number, shippingCents = 500) {
    return store.rpc<Offer>('checkout_register_offer', { p_item: itemId, p_title: 'Headphones',
      p_price: priceCents, p_shipping: shippingCents });
  }
  return { db, store, gateway, service, item, watch, price };
}
