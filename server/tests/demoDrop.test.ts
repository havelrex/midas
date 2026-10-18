import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MERCHANT, type Offer } from '../src/checkout/model.js';
import { toProductDetail, toShoppingItem, type SerpApi } from '../src/listings/serpapi.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { createDemo, SANDBOX_MERCHANT } from '../src/scoring/demo.js';
import { createDemoDrop, type DemoItem, type ItemsPort } from '../src/scoring/demoDrop.js';
import { appendHistory, defaultHistoryDir, loadPriceHistory } from '../src/scoring/priceHistory.js';
import { createQualityService } from '../src/scoring/qualityService.js';
import { createScorer } from '../src/scoring/scoreProduct.js';

const cfg = loadScoringConfig('electronics');
const ITEM = '11111111-1111-4111-8111-111111111111';
const raw = (merchant: string, price: number) => ({ title: 'Sony WH-1000XM5 Wireless Headphones', source: merchant, extracted_price: price,
  delivery: 'Free delivery', rating: 4.7, reviews: 5000, immersive_product_page_token: 't', product_link: 'u' });
const serp = (merchants: [string, number][]): SerpApi => ({
  searchShopping: async () => merchants.map(([m, p]) => toShoppingItem(raw(m, p))!),
  productDetail: async () => toProductDetail({ product_results: { rating: 4.7, reviews: 5000,
    ratings: [{ stars: 1, amount: 100 }, { stars: 2, amount: 100 }, { stars: 3, amount: 200 }, { stars: 4, amount: 800 }, { stars: 5, amount: 3800 }],
    user_reviews: [{ rating: 5, text: 'Two years and still perfect' }] } }),
});
const trusted: [string, number][] = [['Best Buy', 299], ['Walmart', 305], ['Target', 312], ['Costco', 319], ['Lowe\'s', 329]];
const goodSignals = JSON.stringify({ failure_mentions: 1, early_failure_mentions: 0, durability_praise: 12, expert_reliability_cons: 0, evidence_quote: '' });

function setup(merchants = trusted, watchThreshold: number | null = 22900) {
  const dir = mkdtempSync(`${tmpdir()}/dd-`) + '/';
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const score = createScorer({ serp: serp(merchants), demo, historyDir: dir, now: () => new Date('2026-10-18T12:00:00Z'),
    quality: createQualityService({ cfg: cfg.quality, generate: async () => goodSignals }) });
  const item: DemoItem = { id: ITEM, user_id: 'u1', name: 'Sony WH-1000XM5', category: 'Headphones', brand: 'Sony', model: 'WH-1000XM5', summary: '', target_price: null };
  const updates: unknown[] = [];
  const items: ItemsPort = { get: async (id) => (id === ITEM ? item : null), update: async (_id, patch) => { updates.push(patch); } };
  let offer: Offer | null = null;
  const registered: Record<string, unknown>[] = [];
  const store = {
    one: async <T,>(table: string) => (table === 'checkout_offers' ? offer as T | null
      : table === 'checkout_watches' && watchThreshold != null ? { threshold_cents: watchThreshold, state: 'active' } as T : null),
    rpc: async <T,>(_name: string, args: Record<string, unknown>) => {
      registered.push(args);
      offer = { id: 'o1', item_id: ITEM, merchant: MERCHANT, title: String(args.p_title), price_cents: Number(args.p_price),
        shipping_cents: Number(args.p_shipping), currency: 'usd', revision: registered.length, active: true };
      return offer as T;
    },
  };
  return { drop: createDemoDrop({ demo, score, items, store }), demo, score, updates, registered, dir };
}

test('the sandbox store and the checkout offer use one merchant name', () => {
  assert.equal(SANDBOX_MERCHANT, MERCHANT);
});

test('createOffer registers the offer at the pre-drop price and is idempotent', async () => {
  const t = setup();
  const first = await t.drop.createOffer('u1', ITEM);
  assert.deepEqual(first, { price: 305, created: true }); // 2% above Best Buy's $299
  assert.deepEqual([t.registered[0].p_price, t.registered[0].p_shipping], [30500, 0]);
  assert.deepEqual(await t.drop.createOffer('u1', ITEM), { price: 305, created: false });
  assert.equal(t.registered.length, 1);
});

test('the drop updates the offer, the history, and the saved card together', async () => {
  const t = setup();
  await t.drop.createOffer('u1', ITEM);
  const result = await t.drop.drop('u1', ITEM);
  assert.equal(result.price, 228); // $1 under the watch threshold of $229, below every real store
  assert.equal(result.verdict, 'buy_now');
  assert.equal(t.registered.at(-1)?.p_price, 22800); // what the watcher compares to the threshold
  const card = t.updates[0] as { verdict: string; best_listing: { merchant: string; price: number }; subscores: { timing: { value: number } } };
  assert.equal(card.verdict, 'buy_now');
  assert.equal(card.best_listing.merchant, MERCHANT);
  assert.equal(card.best_listing.price, 228);
  assert.equal(card.subscores.timing.value, 100);
  assert.equal(loadPriceHistory('Sony', 'WH-1000XM5', t.dir).at(-1)?.price, 228);
});

test('the watch threshold wins over the saved target, an explicit target wins over both, and a restart is survivable', async () => {
  const t = setup(trusted, null);
  assert.equal((await t.drop.drop('u1', ITEM, 240)).price, 239);
  const fresh = setup(trusted, 25000); // a brand-new server process has no in-memory state
  assert.equal((await fresh.drop.drop('u1', ITEM)).price, 249);
});

test('only the owner can use it, and unknown items are rejected', async () => {
  const t = setup();
  await assert.rejects(t.drop.drop('someone-else', ITEM), { status: 404 });
  await assert.rejects(t.drop.createOffer('u1', '22222222-2222-4222-8222-222222222222'), { status: 404 });
});

test('no trusted store means no sandbox offer', async () => {
  const t = setup([['Shop A', 250], ['Shop B', 260], ['Shop C', 270]]);
  await assert.rejects(t.drop.createOffer('u1', ITEM), { status: 409 });
});

test('history overlay merges over the seed, newest entry per date wins, and never edits the seed', () => {
  const seed = mkdtempSync(`${tmpdir()}/seed-`) + '/', overlay = mkdtempSync(`${tmpdir()}/over-`) + '/';
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-16', price: 329 }, seed);
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-17', price: 329 }, seed);
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-17', price: 240 }, overlay);
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-18', price: 228 }, overlay);
  assert.deepEqual(loadPriceHistory('Sony', 'WH-1000XM5', seed, overlay).map((p) => p.price), [329, 240, 228]);
  assert.deepEqual(loadPriceHistory('Sony', 'WH-1000XM5', seed).map((p) => p.price), [329, 329]); // seed untouched
});

test('routes: /demo/offer and /demo/price-drop with an item_id', async () => {
  const logger = { info() {}, error() {} };
  const t = setup();
  const app = createApp({ logger, verifyToken: async () => 'u1', demo: t.demo, demoDrop: t.drop, score: t.score });
  const auth = { Authorization: 'Bearer t' };
  await request(app).post('/demo/offer').set(auth).send({}).expect(400);
  await request(app).post('/demo/offer').set(auth).send({ item_id: ITEM }).expect(200, { price: 305, created: true });
  await request(app).post('/demo/price-drop').set(auth).send({ item_id: 'nope' }).expect(400);
  await request(app).post('/demo/price-drop').set(auth).send({ item_id: ITEM, target_price: -1 }).expect(400);
  const res = await request(app).post('/demo/price-drop').set(auth).send({ item_id: ITEM }).expect(200);
  assert.equal(res.body.verdict, 'buy_now');
  const other = createApp({ logger, verifyToken: async () => 'u2', demo: t.demo, demoDrop: t.drop });
  await request(other).post('/demo/price-drop').set(auth).send({ item_id: ITEM }).expect(404);
  const unconfigured = createApp({ logger, verifyToken: async () => 'u1', demo: t.demo });
  await request(unconfigured).post('/demo/price-drop').set(auth).send({ item_id: ITEM }).expect(503);
  await request(createApp({ logger, verifyToken: async () => 'u1' })).post('/demo/offer').set(auth).send({ item_id: ITEM }).expect(404);
});
