import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AnalysisOutput } from '../src/analysis/gemini.js';
import { toProductDetail, toShoppingItem, type SerpApi } from '../src/listings/serpapi.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { createDemo, featuredProduct, normalizeFeatured, SANDBOX_MERCHANT } from '../src/scoring/demo.js';
import { defaultHistoryDir, loadPriceHistory } from '../src/scoring/priceHistory.js';
import { createQualityService } from '../src/scoring/qualityService.js';
import { createScorer } from '../src/scoring/scoreProduct.js';

const cfg = loadScoringConfig('electronics');
const AIRPODS: AnalysisOutput = { category: 'Headphones', brand: 'Apple', model: 'AirPods Max', name: 'Apple AirPods Max', summary: 's', confidence: 0.9 };
const SONY: AnalysisOutput = { category: 'Headphones', brand: 'Sony', model: 'WH-1000XM5', name: 'Sony WH-1000XM5', summary: 's', confidence: 0.9 };
const now = () => new Date('2026-10-18T12:00:00Z');

const raw = (title: string, merchant: string, price: number) => ({ title, source: merchant, extracted_price: price, delivery: 'Free delivery',
  rating: 4.6, reviews: 12294, immersive_product_page_token: `t-${merchant}`, product_link: `https://g.example/${merchant}` });
const serpFor = (title: string, merchants: [string, number][]): SerpApi => ({
  productReviews: async () => [],
  searchShopping: async () => merchants.map(([m, p]) => toShoppingItem(raw(title, m, p))!),
  productDetail: async () => toProductDetail({ product_results: { rating: 4.6, reviews: 12294,
    ratings: [{ stars: 1, amount: 400 }, { stars: 2, amount: 400 }, { stars: 3, amount: 900 }, { stars: 4, amount: 2600 }, { stars: 5, amount: 8000 }],
    user_reviews: [{ rating: 5, text: 'Great after two years' }] } }),
});
const signals = JSON.stringify({ failure_mentions: 2, early_failure_mentions: 0, durability_praise: 10, expert_reliability_cons: 0, evidence_quote: '' });
const quality = () => createQualityService({ cfg: cfg.quality, generate: async () => signals });
const AIRPODS_TITLE = 'Apple AirPods Max Wireless Over-Ear Headphones';
const airpodsStores: [string, number][] = [['Apple', 549], ['Best Buy', 549], ['Amazon.com', 479], ['Target', 549], ['Walmart', 539]];

function airpodsSetup(merchants = airpodsStores, withDemo = true) {
  const dir = mkdtempSync(`${tmpdir()}/fd-`) + '/';
  copyFileSync(`${defaultHistoryDir}apple-airpodsmax.json`, `${dir}apple-airpodsmax.json`);
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  const demo = withDemo ? createDemo({ cfg: cfg.demo, historyDir: dir }) : undefined;
  const score = (title = AIRPODS_TITLE) =>
    createScorer({ serp: serpFor(title, merchants), quality: quality(), demo, historyDir: dir, now });
  return { dir, demo, score };
}

test('config: featured_products is identical in electronics.json and default.json', () => {
  assert.deepEqual(loadScoringConfig('default').demo, cfg.demo);
  assert.deepEqual(cfg.demo.featured_products, [{ brand: 'Apple', model: 'AirPods Max', aliases: ['airpods max'], sandbox_price_ratio: 0.97 }]);
});

test('featured matching is punctuation- and case-proof', () => {
  assert.ok(featuredProduct(cfg.demo, { brand: 'apple', model: 'AirPods-Max' }));
  assert.ok(featuredProduct(cfg.demo, { brand: 'Apple', model: 'airpodsmax' }));
  assert.equal(featuredProduct(cfg.demo, { brand: 'Sony', model: 'WH-1000XM5' }), undefined);
  assert.equal(featuredProduct(cfg.demo, { brand: 'Apple', model: 'AirPods Pro' }), undefined);
});

test('featured product: the sandbox is the best listing from the first scan, priced just under the cheapest real total', async () => {
  const t = airpodsSetup();
  const { output } = await t.score()(AIRPODS);
  assert.equal(output.best_listing?.merchant, SANDBOX_MERCHANT);
  assert.equal(output.best_listing?.price, Math.floor(479 * 0.97)); // 464, under Amazon's $479
  assert.equal(t.demo!.sandboxPrice(AIRPODS), 464);
});

test('featured product: only unvouched real listings still get the sandbox', async () => {
  const t = airpodsSetup([['Shop A', 549], ['Shop B', 559], ['Shop C', 569]]);
  const { output } = await t.score()(AIRPODS);
  assert.equal(output.best_listing?.merchant, SANDBOX_MERCHANT);
  assert.equal(output.best_listing?.price, Math.floor(549 * 0.97));
});

test('featured product: no real listing at all means no sandbox', async () => {
  const t = airpodsSetup([]);
  const { output } = await t.score()(AIRPODS);
  assert.equal(output.best_listing, null);
});

test('non-featured product is unchanged: real store wins, sandbox 2% above, only beside a vouched store', async () => {
  const dir = mkdtempSync(`${tmpdir()}/nf-`) + '/';
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const title = 'Sony WH-1000XM5 Wireless Headphones';
  const trusted: [string, number][] = [['Best Buy', 299], ['Walmart', 305], ['Target', 312], ['Costco', 319], ['Newegg.com', 329]];
  const out = await createScorer({ serp: serpFor(title, trusted), quality: quality(), demo, historyDir: dir, now })(SONY);
  assert.equal(out.output.best_listing?.merchant, 'Best Buy');
  assert.equal(demo.sandboxPrice(SONY), 305);
  const d2 = createDemo({ cfg: cfg.demo, historyDir: dir });
  const unv = await createScorer({ serp: serpFor(title, [['Shop A', 250], ['Shop B', 260], ['Shop C', 270]]), quality: quality(), demo: d2, historyDir: dir, now })(SONY);
  assert.notEqual(unv.output.best_listing?.merchant, SANDBOX_MERCHANT);
  assert.equal(d2.sandboxPrice(SONY), null);
});

test('featured product: the sandbox never moves the price reference', async () => {
  const withDemo = await airpodsSetup().score()(AIRPODS);
  const without = await airpodsSetup(airpodsStores, false).score()(AIRPODS);
  const typical = (r?: string) => /typical (\$[\d,.]+)/.exec(r ?? '')?.[1];
  assert.ok(typical(without.output.subscores.price?.reason));
  assert.equal(typical(withDemo.output.subscores.price?.reason), typical(without.output.subscores.price?.reason));
  assert.equal(withDemo.meta.confidence.price, without.meta.confidence.price);
});

test('AirPods Max story offline: Wait before the drop, Buy now after it', async () => {
  const t = airpodsSetup([['Apple', 549], ['Best Buy', 549], ['Amazon.com', 549], ['Target', 549], ['Walmart', 549]]);
  const score = t.score();
  const before = (await score(AIRPODS)).output;
  assert.equal(before.best_listing?.merchant, SANDBOX_MERCHANT);
  assert.equal(before.best_listing?.price, 532); // floor(0.97 * 549)
  assert.equal(before.verdict, 'wait');
  assert.equal(before.suggested_target_price, 399);
  const dropped = t.demo!.triggerPriceDrop(AIRPODS, before.suggested_target_price);
  assert.equal(dropped, 398);
  assert.ok(dropped! < 532);
  const after = (await score(AIRPODS)).output;
  assert.equal(after.best_listing?.price, 398);
  assert.equal(after.subscores.timing?.value, 100);
  assert.equal(after.verdict, 'buy_now');
  assert.ok(after.score > before.score);
  console.log('airpods story', { before: [before.score, before.verdict], after: [after.score, after.verdict] });
});

test('the AirPods Max seed history loads: 90 days, low 399, high 549', () => {
  const h = loadPriceHistory('Apple', 'AirPods Max', defaultHistoryDir, undefined);
  assert.equal(h.length, 90);
  assert.equal(h.at(-1)?.date, '2026-10-17');
  assert.equal(Math.min(...h.map((p) => p.price)), 399);
  assert.equal(Math.max(...h.map((p) => p.price)), 549);
});

test('normalizeFeatured fills a missing model from the name, and leaves everything else alone', () => {
  const base = { ...AIRPODS, model: '', brand: '' };
  assert.deepEqual([normalizeFeatured(cfg.demo, base).model, normalizeFeatured(cfg.demo, base).brand], ['AirPods Max', 'Apple']);
  assert.equal(normalizeFeatured(cfg.demo, { ...base, brand: 'Apple' }).model, 'AirPods Max');
  assert.equal(normalizeFeatured(cfg.demo, { ...base, brand: 'Sony' }).model, ''); // brand conflicts
  assert.equal(normalizeFeatured(cfg.demo, { ...base, name: 'Sony headphones' }).model, '');
  const withModel = { ...AIRPODS, model: 'AirPods Pro' };
  assert.equal(normalizeFeatured(cfg.demo, withModel), withModel);
});

test('POST /score: 422 on an empty model, 200 for AirPods Max with an empty model but a matching name', async () => {
  const t = airpodsSetup();
  const app = createApp({ logger: { info() {}, error() {} }, verifyToken: async () => 'u', demo: t.demo, score: t.score() });
  const auth = { Authorization: 'Bearer t' };
  await request(app).post('/score').set(auth).send({ ...SONY, model: '  ' }).expect(422, { error: 'Retake the photo: the exact model could not be read.' });
  await request(app).post('/score').set(auth).send({ ...AIRPODS, model: '', brand: '' }).expect(200);
  await request(app).post('/score').set(auth).send({ ...AIRPODS, model: '', name: 'Generic headphones' }).expect(422);
});
