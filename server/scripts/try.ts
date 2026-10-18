// Terminal checks for the rating algorithm. Usage: npm run try:<name> -- <args>
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config/env.js';
import { createDiskCache } from '../src/lib/diskCache.js';
import { withCache } from '../src/listings/cachedSerpApi.js';
import { buildQuery, createSerpApi, toProductDetail, toShoppingItem } from '../src/listings/serpapi.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { createDemo } from '../src/scoring/demo.js';
import { scorePrice } from '../src/scoring/price.js';
import { defaultHistoryDir } from '../src/scoring/priceHistory.js';
import { productKey } from '../src/scoring/util.js';
import { scoreQuality } from '../src/scoring/quality.js';
import { createGeminiGenerate } from '../src/scoring/qualityExtract.js';
import { createQualityService } from '../src/scoring/qualityService.js';
import { scoreReviews } from '../src/scoring/reviews.js';
import { createScorer } from '../src/scoring/scoreProduct.js';
import { scoreTiming } from '../src/scoring/timing.js';
import type { Listing } from '../src/scoring/types.js';

const [cmd, ...args] = process.argv.slice(2);
const nums = args.map(Number);
const cfg = loadScoringConfig('electronics');
const show = (label: string, v: unknown) => console.log(`${label}\n${JSON.stringify(v, null, 2)}`);
const usage = (u: string) => { console.error(`usage: npm run try:${cmd} -- ${u}`); process.exit(1); };

if (cmd === 'reviews') {
  if (nums.length < 2 || nums.some(Number.isNaN)) usage('<avg stars> <review count> [5star 4star 3star 2star 1star]');
  const b = nums.length >= 7 ? { 5: nums[2], 4: nums[3], 3: nums[4], 2: nums[5], 1: nums[6] } : null;
  show('reviews', scoreReviews({ avg: nums[0], n: nums[1], breakdown: b }, cfg.reviews));
} else if (cmd === 'timing') {
  if (nums.length < 3 || nums.some(Number.isNaN)) usage('<today> <low> <high> [days=90]');
  const [today, low, high, days = 90] = nums;
  const history = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), price: i === 3 ? low : high }));
  show('timing (no sale event in range)', scoreTiming({ today, history, now: new Date('2026-07-01T00:00:00Z') }, cfg));
} else if (cmd === 'quality') {
  if (nums.length < 5 || nums.some(Number.isNaN)) usage('<reviews read> <failures> <early failures> <praise> <expert cons>');
  show('quality', scoreQuality({ reviews_read: nums[0], failure_mentions: nums[1], early_failure_mentions: nums[2],
    durability_praise: nums[3], expert_reliability_cons: nums[4], evidence_quote: 'battery swelled after 4 months' }, cfg.quality));
} else if (cmd === 'price') {
  const L = (merchant: string, price: number, extra: Partial<Listing> = {}): Listing => ({ source: 'serpapi', merchant, title: 'Sony WH-1000XM5 Headphones',
    price, shipping: 0, url: 'u', sellerRating: null, condition: 'new', ...extra });
  const sample = [L('Best Buy', 279), L('Newegg', 319), L('Adorama', 325), L('Walmart', 329), L('BuyDig', 349),
    L('Case Shop', 24, { title: 'Sony WH-1000XM5 case' }), L('eBay seller', 150, { condition: 'used' }), L('Bundle Co', 900)];
  const r = scorePrice(sample, { model: 'WH-1000XM5' }, cfg);
  show('price (spec example: median 325, best 279)', { sub: r.sub, confidence: r.confidence, reference: r.reference, best: r.bestListing, kept: r.cleaned.map((l) => l.merchant) });
} else if (cmd === 'score') {
  // Whole pipeline on fixtures, no network: before and after the demo price drop.
  const raw = (merchant: string, price: number) => ({ title: 'Sony WH-1000XM5 Wireless Headphones', source: merchant, extracted_price: price,
    delivery: 'Free delivery', rating: 4.7, reviews: 5000, immersive_product_page_token: 't', product_link: 'u' });
  const items = [raw('Best Buy', 299), raw('Newegg', 305), raw('Adorama', 312), raw('Amazon.com', 319), raw('Walmart', 329)].map((r) => toShoppingItem(r)!);
  const detail = toProductDetail({ product_results: { rating: 4.7, reviews: 5000, ratings: [{ stars: 1, amount: 100 }, { stars: 2, amount: 100 },
    { stars: 3, amount: 200 }, { stars: 4, amount: 800 }, { stars: 5, amount: 3800 }], user_reviews: [{ rating: 5, text: 'Two years and still perfect' }] } });
  const dir = mkdtempSync(`${tmpdir()}/try-`) + '/';
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const generate = async () => JSON.stringify({ failure_mentions: 1, early_failure_mentions: 0, durability_praise: 12, expert_reliability_cons: 0, evidence_quote: '' });
  const score = createScorer({ serp: { searchShopping: async () => items, productDetail: async () => detail },
    quality: createQualityService({ cfg: cfg.quality, generate }), demo, historyDir: dir, now: () => new Date('2026-10-18T12:00:00Z') });
  const product = { category: 'Headphones', brand: 'Sony', model: 'WH-1000XM5', name: 'Sony WH-1000XM5 headphones', summary: '', confidence: 0.9 };
  const before = await score(product);
  show('BEFORE the drop', { ...before.output, weights: before.meta.weights, verdictCapped: before.meta.verdictCapped });
  const dropped = demo.triggerPriceDrop(product, before.output.suggested_target_price);
  console.log(`\n>>> price drop to $${dropped}\n`);
  const after = await score(product);
  show('AFTER the drop', after.output);
} else if (cmd === 'live') {
  // Real SerpAPI (2 searches) and real Gemini. Costs credits.
  const [brand, model, category = 'Headphones'] = args;
  if (!brand || !model) usage('<brand> <model> [category]');
  const config = loadConfig();
  const demo = config.demoMode ? createDemo({ cfg: cfg.demo }) : undefined;
  const cache = createDiskCache({ ttlMs: (config.cacheTtlMinutes ?? 60) * 60_000 });
  const serp = createSerpApi({ apiKey: config.serpApiKey });
  const score = createScorer({ serp: serp && withCache(serp, cache), demo,
    quality: createQualityService({ cfg: cfg.quality, cache, generate: createGeminiGenerate({ apiKey: config.geminiApiKey, model: config.geminiModel!, timeoutMs: cfg.quality.gemini_timeout_ms }) }) });
  const r = await score({ category, brand, model, name: `${brand} ${model}`, summary: '', confidence: 1 });
  show(`live score (demo mode ${config.demoMode ? 'on' : 'off'})`, { ...r.output, weights: r.meta.weights, confidence: r.meta.confidence, verdictCapped: r.meta.verdictCapped });
} else if (cmd === 'demo') {
  // The stage story on live (cached) data: stores, then Wait, the price drop, and Buy now. Uses a temp copy of the history.
  const [brand = 'Sony', model = 'WH-1000XM5', category = 'Headphones'] = args;
  const config = loadConfig();
  const dir = mkdtempSync(`${tmpdir()}/demo-`) + '/';
  copyFileSync(`${defaultHistoryDir}sony-wh1000xm5.json`, `${dir}sony-wh1000xm5.json`);
  const cache = createDiskCache({ ttlMs: (config.cacheTtlMinutes ?? 60) * 60_000 });
  const raw = createSerpApi({ apiKey: config.serpApiKey });
  if (!raw) { console.error('SERPAPI_KEY is not set'); process.exit(1); }
  const serp = withCache(raw, cache);
  const demo = createDemo({ cfg: cfg.demo, historyDir: dir });
  const quality = createQualityService({ cfg: cfg.quality, cache, generate: createGeminiGenerate({ apiKey: config.geminiApiKey, model: config.geminiModel!, timeoutMs: cfg.quality.gemini_timeout_ms }) });
  const score = createScorer({ serp, quality, demo, historyDir: dir });
  const product = { category, brand, model, name: `${brand} ${model}`, summary: '', confidence: 1 };

  const items = await serp.searchShopping(buildQuery(product), `product:${productKey(brand, model)}`);
  const priced = scorePrice(items.map((i) => i.listing), { model }, cfg);
  const kept = new Set(priced.cleaned.map((l) => l));
  console.log(`\nSTORES (${items.length} results, ${priced.cleanedCount} kept, typical $${priced.reference}, vouched: ${priced.vouched})`);
  for (const i of [...items].sort((a, b) => a.listing.price - b.listing.price)) {
    const l = i.listing;
    const mark = priced.cleaned.some((c) => c.merchant === l.merchant && c.price === l.price) ? 'kept   ' : 'dropped';
    const trusted = cfg.price.trusted_retailers.some((t) => t.toLowerCase() === l.merchant.toLowerCase());
    console.log(`  ${mark} $${String(l.price + l.shipping).padEnd(8)} ${l.condition.padEnd(11)} ${trusted ? 'TRUSTED ' : '        '}${l.merchant}`);
  }
  const line = (label: string, r: Awaited<ReturnType<typeof score>>) => {
    const o = r.output;
    const subs = (['quality', 'reviews', 'price', 'timing'] as const).map((k) => `${k} ${o.subscores[k]?.value ?? '-'}`).join('  ');
    console.log(`\n${label}: score ${o.score}  verdict ${o.verdict.toUpperCase()}${r.meta.verdictCapped ? ' (capped)' : ''}\n  ${subs}\n  best: ${o.best_listing?.merchant} $${o.best_listing?.price}  target: ${o.suggested_target_price}`);
    for (const k of ['quality', 'reviews', 'price', 'timing'] as const) console.log(`  ${k}: ${o.subscores[k]?.reason}`);
  };
  const before = await score(product);
  line('BEFORE', before);
  const dropped = demo.triggerPriceDrop(product, before.output.suggested_target_price);
  console.log(`\n>>> price drop to $${dropped}`);
  line('AFTER ', await score(product));
} else {
  console.error('commands: reviews | timing | quality | price | score | live | demo');
  process.exit(1);
}
