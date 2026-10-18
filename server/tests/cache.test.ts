import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseConfig } from '../src/config/env.js';
import { createDiskCache } from '../src/lib/diskCache.js';
import { withCache } from '../src/listings/cachedSerpApi.js';
import { toShoppingItem, type SerpApi } from '../src/listings/serpapi.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { loadPriceHistory } from '../src/scoring/priceHistory.js';
import { createQualityService } from '../src/scoring/qualityService.js';
import { productKey } from '../src/scoring/util.js';

const dir = () => mkdtempSync(`${tmpdir()}/cache-`) + '/';

test('disk cache stores values across instances and expires them', () => {
  const d = dir();
  let t = 1_000;
  const a = createDiskCache({ dir: d, ttlMs: 500, now: () => t });
  assert.equal(a.get('k'), undefined);
  a.set('k', { n: 1 });
  assert.deepEqual(createDiskCache({ dir: d, ttlMs: 500, now: () => t }).get('k'), { n: 1 }); // a "restart"
  t += 501;
  assert.equal(a.get('k'), undefined);
});

test('disk cache treats corrupt or unwritable storage as a miss, never an error', () => {
  const d = dir();
  const c = createDiskCache({ dir: d, ttlMs: 1000 });
  c.set('x', 1);
  writeFileSync(`${d}${readdirSync(d)[0]}`, '{not json');
  assert.equal(c.get('x'), undefined);
  const bad = createDiskCache({ dir: '/dev/null/nope/', ttlMs: 1000 });
  assert.doesNotThrow(() => bad.set('x', 1));
  assert.equal(bad.get('x'), undefined);
});

test('cached SerpAPI calls the network once per query and detail token, ignoring case and spacing', async () => {
  let searches = 0, details = 0;
  const raw = { title: 'Sony WH-1000XM5', source: 'Best Buy', extracted_price: 300, immersive_product_page_token: 't1' };
  const serp: SerpApi = {
    searchShopping: async () => { searches++; return [toShoppingItem(raw)!]; },
    productDetail: async () => { details++; return { avg: 4.6, n: 100, breakdown: null, reviews: [], expertSnippets: [] }; },
  };
  const cached = withCache(serp, createDiskCache({ dir: dir(), ttlMs: 60_000 }));
  const first = await cached.searchShopping('Sony WH-1000XM5 Headphones');
  assert.deepEqual(await cached.searchShopping('  sony  wh-1000xm5 HEADPHONES '), first);
  await cached.productDetail('t1'); await cached.productDetail('t1');
  await cached.searchShopping('Bose QC45 Headphones');
  assert.deepEqual([searches, details], [2, 1]);
});

test('failures are not cached', async () => {
  let calls = 0;
  const serp: SerpApi = {
    searchShopping: async () => { calls++; if (calls === 1) throw new Error('down'); return []; },
    productDetail: async () => null,
  };
  const cached = withCache(serp, createDiskCache({ dir: dir(), ttlMs: 60_000 }));
  await assert.rejects(cached.searchShopping('q'));
  assert.deepEqual(await cached.searchShopping('q'), []);
  assert.equal(calls, 2);
});

test('quality results persist across service instances without calling Gemini again', async () => {
  const cfg = loadScoringConfig('electronics').quality;
  const cache = createDiskCache({ dir: dir(), ttlMs: 60_000 });
  let calls = 0;
  const generate = async () => { calls++; return JSON.stringify({ failure_mentions: 1, early_failure_mentions: 0, durability_praise: 2, expert_reliability_cons: 0, evidence_quote: '' }); };
  const data = { reviews: [{ rating: 2, text: 'meh' }], expertSnippets: [] };
  const product = { brand: 'Sony', model: 'WH-1000XM5', name: 'Sony' };
  const a = await createQualityService({ cfg, generate, cache }).assess(product, data);
  const b = await createQualityService({ cfg, generate, cache }).assess({ ...product, model: 'WH1000XM5' }, data);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test('model matching ignores punctuation, case, and spacing', () => {
  assert.equal(productKey('Sony', 'WH-1000XM5'), productKey(' sony ', 'wh1000xm5'));
  assert.equal(productKey('Sony', 'WH 1000XM5'), productKey('SONY', 'WH-1000XM5'));
  for (const model of ['WH-1000XM5', 'WH1000XM5', 'wh 1000 xm5']) assert.equal(loadPriceHistory('Sony', model).length, 90);
  assert.equal(loadPriceHistory('Sony', 'WH-1000XM4').length, 0);
});

test('cache lifetime is configurable and validated', () => {
  const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' };
  assert.equal(parseConfig(base).cacheTtlMinutes, 60);
  assert.equal(parseConfig({ ...base, SCORE_CACHE_TTL_MINUTES: '1440' }).cacheTtlMinutes, 1440);
  for (const bad of ['0', '-5', 'abc', '1.5']) assert.throws(() => parseConfig({ ...base, SCORE_CACHE_TTL_MINUTES: bad }), /SCORE_CACHE_TTL_MINUTES/);
});

test('different spellings of one model share cached search results', async () => {
  let searches = 0;
  const serp: SerpApi = { searchShopping: async () => { searches++; return []; }, productDetail: async () => null };
  const cached = withCache(serp, createDiskCache({ dir: dir(), ttlMs: 60_000 }));
  const key = `product:${productKey('Sony', 'WH-1000XM5')}`;
  await cached.searchShopping('Sony WH-1000XM5 Headphones', key);
  await cached.searchShopping('Sony WH1000XM5 Headphones', `product:${productKey('SONY', 'wh1000xm5')}`);
  assert.equal(searches, 1);
});
