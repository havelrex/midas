import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AnalysisOutput } from '../src/analysis/gemini.js';
import { ListingsError, toProductDetail, toShoppingItem, type SerpApi } from '../src/listings/serpapi.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { createDemo, SANDBOX_MERCHANT } from '../src/scoring/demo.js';
import { defaultHistoryDir } from '../src/scoring/priceHistory.js';
import { createQualityService } from '../src/scoring/qualityService.js';
import { createScorer } from '../src/scoring/scoreProduct.js';

const cfg = loadScoringConfig('electronics');
const analysis: AnalysisOutput = { category: 'Headphones', brand: 'Sony', model: 'WH-1000XM5', name: 'Sony WH-1000XM5 headphones', summary: 's', confidence: 0.9 };
const raw = (merchant: string, price: number, extra: Record<string, unknown> = {}) => ({
  title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', source: merchant, extracted_price: price, delivery: 'Free delivery',
  rating: 4.7, reviews: 5000, immersive_product_page_token: `tok-${merchant}`, product_link: `https://g.example/${merchant}`, ...extra });
const rawListings = [raw('Best Buy', 299), raw('Newegg', 305), raw('Adorama', 312), raw('Amazon.com', 319), raw('Walmart', 329), raw('BuyDig', 335),
  raw('Case Shop', 24, { title: 'Sony WH-1000XM5 case' }), raw('eBay - x', 150, { second_hand_condition: 'pre-owned' })];
const detail = { product_results: { rating: 4.7, reviews: 5000,
  ratings: [{ stars: 1, amount: 100 }, { stars: 2, amount: 100 }, { stars: 3, amount: 200 }, { stars: 4, amount: 800 }, { stars: 5, amount: 3800 }],
  user_reviews: [{ rating: 5, text: 'Two years and still perfect' }, { rating: 4, text: 'Great sound' }] } };
const serp = (overrides: Partial<SerpApi> = {}): SerpApi => ({
  productReviews: async () => [],
  searchShopping: async () => rawListings.map((r) => toShoppingItem(r)!),
  productDetail: async () => {
    const { toProductDetail } = await import('../src/listings/serpapi.js');
    return toProductDetail(detail);
  },
  ...overrides,
});
const goodSignals = JSON.stringify({ failure_mentions: 1, early_failure_mentions: 0, durability_praise: 12, expert_reliability_cons: 0, evidence_quote: '' });
const quality = () => createQualityService({ cfg: cfg.quality, generate: async () => goodSignals });
const now = () => new Date('2026-10-18T12:00:00Z');
const freshHistory = () => {
  const dir = mkdtempSync(`${tmpdir()}/scorer-`) + '/';
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  return dir;
};

test('full pipeline: cleans junk, picks the real best listing, scores all four sub-scores', async () => {
  const score = createScorer({ serp: serp(), quality: quality(), historyDir: freshHistory(), now });
  const { output, meta } = await score(analysis);
  assert.equal(output.best_listing?.merchant, 'Best Buy');
  for (const k of ['quality', 'price', 'reviews', 'timing'] as const) assert.ok(output.subscores[k], `${k} present`);
  assert.equal(output.subscores.reviews?.reason, '4.7 stars across 5,000 reviews');
  assert.ok(output.score >= 0 && output.score <= 100);
  assert.equal(meta.confidence.price, 1);
  assert.equal(meta.confidence.timing, 1);
});

test('same inputs give the same score twice (stage item is stable)', async () => {
  const score = createScorer({ serp: serp(), quality: quality(), historyDir: freshHistory(), now });
  assert.deepEqual((await score(analysis)).output, (await score(analysis)).output);
});

test('quality failing or timing out never blocks the card', async () => {
  const broken = createQualityService({ cfg: cfg.quality, generate: async () => { throw new Error('boom'); } });
  const { output } = await createScorer({ serp: serp(), quality: broken, historyDir: freshHistory(), now })(analysis);
  assert.equal(output.subscores.quality, null);
  assert.ok(output.subscores.reviews && output.subscores.price);
  const noDetail = createScorer({ serp: serp({ productDetail: async () => { throw new Error('x'); } }), quality: quality(), historyDir: freshHistory(), now });
  assert.equal((await noDetail(analysis)).output.subscores.quality, null);
});

test('no history leaves timing null; no listings leaves price null', async () => {
  const noHistory = await createScorer({ serp: serp(), quality: quality(), historyDir: mkdtempSync(`${tmpdir()}/e-`) + '/', now })(analysis);
  assert.equal(noHistory.output.subscores.timing, null);
  const none = await createScorer({ serp: serp({ searchShopping: async () => [] }), quality: quality(), historyDir: freshHistory(), now })(analysis);
  assert.equal(none.output.subscores.price, null);
  assert.equal(none.output.best_listing, null);
});

test('demo: sandbox sits above the best real price, then the drop flips the verdict', async () => {
  const dir = freshHistory();
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const score = createScorer({ serp: serp(), quality: quality(), demo, historyDir: dir, now });

  const before = (await score(analysis)).output;
  assert.equal(before.best_listing?.merchant, 'Best Buy'); // a real store wins
  assert.equal(before.verdict, 'wait');
  assert.equal(before.suggested_target_price, 229);

  assert.equal(demo.triggerPriceDrop({ brand: 'Sony', model: 'WH-1000XM5' }, before.suggested_target_price), 228);
  const after = (await score(analysis)).output;
  assert.equal(after.best_listing?.merchant, SANDBOX_MERCHANT); // wins only by being cheapest
  assert.equal(after.best_listing?.price, 228);
  assert.equal(after.subscores.timing?.value, 100);
  assert.equal(after.subscores.timing?.reason, 'At its lowest price in 90 days');
  assert.equal(after.verdict, 'buy_now');
  assert.equal(after.suggested_target_price, null);
  assert.ok(after.score > before.score);
});

test('demo: the sandbox never moves the reference price and needs a prior score to drop', async () => {
  const dir = freshHistory();
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  assert.equal(demo.triggerPriceDrop({ brand: 'Sony', model: 'WH-1000XM5' }, 250), null);
  const withDemo = await createScorer({ serp: serp(), quality: quality(), demo, historyDir: dir, now })(analysis);
  const without = await createScorer({ serp: serp(), quality: quality(), historyDir: dir, now })(analysis);
  assert.equal(withDemo.output.subscores.price?.reason, without.output.subscores.price?.reason);
});

test('POST /score: auth, validation, success, and unconfigured', async () => {
  const logger = { info() {}, error() {} };
  const dir = freshHistory();
  const app = createApp({ logger, verifyToken: async () => 'u', score: createScorer({ serp: serp(), quality: quality(), historyDir: dir, now }) });
  await request(app).post('/score').send(analysis).expect(401);
  await request(app).post('/score').set('Authorization', 'Bearer t').send({ nope: 1 }).expect(502);
  const res = await request(app).post('/score').set('Authorization', 'Bearer t').send(analysis).expect(200);
  assert.equal(res.body.best_listing.merchant, 'Best Buy');
  assert.equal(res.body.meta, undefined);
  assert.equal(res.body.verdict_capped, false); // the contract field is returned to the app
  const noKey = createApp({ logger, verifyToken: async () => 'u', score: createScorer({ quality: quality(), historyDir: dir }) });
  await request(noKey).post('/score').set('Authorization', 'Bearer t').send(analysis).expect(503);
  const failing = createApp({ logger, verifyToken: async () => 'u', score: createScorer({ serp: serp({ searchShopping: async () => { throw new ListingsError(502, 'down'); } }), quality: quality() }) });
  await request(failing).post('/score').set('Authorization', 'Bearer t').send(analysis).expect(502, { error: 'down' });
});

test('POST /demo/price-drop exists only in demo mode and validates input', async () => {
  const logger = { info() {}, error() {} };
  const dir = freshHistory();
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const app = createApp({ logger, verifyToken: async () => 'u', demo, score: createScorer({ serp: serp(), quality: quality(), demo, historyDir: dir, now }) });
  const auth = { Authorization: 'Bearer t' };
  await request(app).post('/demo/price-drop').set(auth).send({ brand: 'Sony', model: 'WH-1000XM5' }).expect(409);
  await request(app).post('/score').set(auth).send(analysis).expect(200);
  await request(app).post('/demo/price-drop').set(auth).send({ brand: 'Sony' }).expect(400);
  await request(app).post('/demo/price-drop').set(auth).send({ brand: 'Sony', model: 'WH-1000XM5', target_price: -3 }).expect(400);
  await request(app).post('/demo/price-drop').set(auth).send({ brand: 'Sony', model: 'WH-1000XM5', target_price: 229 }).expect(200, { price: 228 });
  const off = createApp({ logger, verifyToken: async () => 'u' });
  await request(off).post('/demo/price-drop').set(auth).send({ brand: 'Sony', model: 'WH-1000XM5' }).expect(404);
});

test('demo: the sandbox store is not added when no real store is vouched for', async () => {
  const dir = freshHistory();
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const unknownOnly = ['Shop A', 'Shop B', 'Shop C'].map((m, i) => toShoppingItem(raw(m, 250 + i * 10))!);
  const score = createScorer({ serp: serp({ searchShopping: async () => unknownOnly }), quality: quality(), demo, historyDir: dir, now });
  const { output, meta } = await score(analysis);
  assert.equal(output.best_listing?.merchant, 'Shop A');
  assert.equal(output.subscores.price?.data_quality, 'limited');
  assert.ok(meta.confidence.price < cfg.verdict.buy_now_min_confidence);
});

test('when the first search finds no trusted store, other wordings are tried and merged', async () => {
  const queries: string[] = [];
  const unknown = ['Shop A', 'Shop B', 'Shop C'].map((m, i) => toShoppingItem(raw(m, 250 + i * 10))!);
  const withTrusted = rawListings.slice(0, 6).map((r) => toShoppingItem(r)!); // Best Buy, Amazon.com, Walmart among them
  const s: SerpApi = { ...serp(), searchShopping: async (q) => { queries.push(q); return queries.length === 1 ? unknown : withTrusted; } };
  const { output } = await createScorer({ serp: s, quality: quality(), historyDir: freshHistory(), now })(analysis);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /wireless/);
  assert.equal(output.best_listing?.merchant, 'Best Buy');
  assert.equal(output.subscores.price?.data_quality, 'ok');
});

test('no extra searches when the first search already has a trusted store, and a failed fallback is ignored', async () => {
  let calls = 0;
  const fine: SerpApi = { ...serp(), searchShopping: async () => { calls++; return rawListings.slice(0, 6).map((r) => toShoppingItem(r)!); } };
  await createScorer({ serp: fine, quality: quality(), historyDir: freshHistory(), now })(analysis);
  assert.equal(calls, 1);
  let n = 0;
  const flaky: SerpApi = { ...serp(), searchShopping: async () => { n++; if (n > 1) throw new Error('down'); return ['Shop A', 'Shop B', 'Shop C'].map((m, i) => toShoppingItem(raw(m, 250 + i * 10))!); } };
  const { output } = await createScorer({ serp: flaky, quality: quality(), historyDir: freshHistory(), now })(analysis);
  assert.equal(n, 3); // both fallbacks tried, both failed, scoring still completes
  assert.equal(output.subscores.price?.data_quality, 'limited');
});

test('few Google reviews are topped up with Walmart reviews; enough Google reviews skip the extra calls', async () => {
  let walmartCalls = 0;
  const prompts: string[] = [];
  const many = Array.from({ length: 20 }, (_, i) => ({ rating: i < 10 ? 1 : 5, text: `walmart review ${i}` }));
  const topUp: SerpApi = { ...serp(), productReviews: async () => { walmartCalls++; return many; } };
  const q = createQualityService({ cfg: cfg.quality, generate: async (prompt) => { prompts.push(prompt); return goodSignals; } });
  const { output } = await createScorer({ serp: topUp, quality: q, historyDir: freshHistory(), now })(analysis);
  assert.equal(walmartCalls, 1);
  assert.match(prompts[0], /walmart review 3/);
  assert.match(prompts[0], /Two years and still perfect/); // Google's own review is kept too
  assert.ok(output.subscores.quality);
  assert.doesNotMatch(output.subscores.quality!.reason, /Only \d+ reviews/);

  walmartCalls = 0;
  const enough = { ...topUp, productDetail: async () => toProductDetail({ product_results: { rating: 4.7, reviews: 5000, ratings: [{ stars: 1, amount: 100 }, { stars: 2, amount: 100 }, { stars: 3, amount: 200 }, { stars: 4, amount: 800 }, { stars: 5, amount: 3800 }],
    user_reviews: Array.from({ length: 16 }, (_, i) => ({ rating: 3, text: `google review ${i}` })) } }) };
  await createScorer({ serp: enough, quality: createQualityService({ cfg: cfg.quality, generate: async () => goodSignals }), historyDir: freshHistory(), now })(analysis);
  assert.equal(walmartCalls, 0);
});

test('a failing Walmart top-up never blocks the score', async () => {
  const broken: SerpApi = { ...serp(), productReviews: async () => { throw new Error('down'); } };
  const { output } = await createScorer({ serp: broken, quality: quality(), historyDir: freshHistory(), now })(analysis);
  assert.ok(output.subscores.quality); // falls back to the reviews Google gave
});
