import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanListings, median } from '../src/listings/clean.js';
import { applyTrustedRetailers, ebayStars } from '../src/listings/sellerRating.js';
import { loadScoringConfig } from '../src/scoring/config.js';
import { effectivePrice, scorePrice } from '../src/scoring/price.js';
import type { Listing } from '../src/scoring/types.js';

const cfg = loadScoringConfig('electronics');
// Existing tests use made-up merchants, so they are trusted here; vouching has its own tests below.
const cfgT = { ...cfg, price: { ...cfg.price, trusted_retailers: [...cfg.price.trusted_retailers, 'A', 'B', 'C', 'D', 'E', 'Z', 'Y', 'Sandbox Store'] } };
const product = { model: 'WH-1000XM5', name: 'Sony WH-1000XM5 headphones' };
const L = (merchant: string, price: number, extra: Partial<Listing> = {}): Listing => ({
  source: 'serpapi', merchant, title: `Sony WH-1000XM5 Wireless Headphones`, price, shipping: 0,
  url: `https://example.com/${merchant}`, sellerRating: null, condition: 'new', ...extra,
});

test('spec worked example: median 325, best 279 free shipping -> 85', () => {
  const r = scorePrice([L('Best Buy', 279), L('A', 319), L('B', 325), L('C', 329), L('D', 349)], product, cfgT);
  assert.equal(r.reference, 325);
  assert.equal(r.sub?.value, 85);
  assert.equal(r.sub?.reason, '$279 at Best Buy, 14% below the typical $325 across 5 listings');
  assert.equal(r.bestListing?.merchant, 'Best Buy');
});

test('cleaning drops accessories, used units, bundles, and wrong models', () => {
  const dirty = [
    L('ok1', 300), L('ok2', 310), L('ok3', 320),
    L('case', 25, { title: 'Sony WH-1000XM5 hard case' }),
    L('bundle', 900, { title: 'Sony WH-1000XM5 bundle' }),
    L('used', 150, { condition: 'used' }),
    L('other', 300, { title: 'Bose QC45 headphones' }),
  ];
  const { listings } = cleanListings(dirty, product, cfg.price);
  assert.deepEqual(listings.map((l) => l.merchant), ['ok1', 'ok2', 'ok3']);
});

test('model matching ignores punctuation and case', () => {
  const { listings } = cleanListings([L('x', 300, { title: 'sony wh 1000 xm5 black' })], product, cfg.price);
  assert.equal(listings.length, 1);
});

test('falls back to name matching when no title has the model, flagged limited', () => {
  const ls = [L('a', 300, { title: 'Sony wireless headphones' }), L('b', 310, { title: 'Sony headphones wireless' }), L('c', 320, { title: 'Sony headphones wireless' })];
  const r = scorePrice(ls, { model: '', name: 'Sony wireless headphones' }, cfg);
  assert.equal(r.sub?.data_quality, 'limited');
});

test('effective price: a cheaper sketchy seller loses to a trusted one', () => {
  const trusted = applyTrustedRetailers([L('Best Buy', 299), L('Random', 295, { sellerRating: 3 })], cfg.price.trusted_retailers);
  assert.ok(Math.abs(effectivePrice(trusted[1], cfg.price.risk_factor) - 306.8) < 1e-9);
  const r = scorePrice([...trusted, L('C', 310), L('D', 315)], product, cfgT);
  assert.equal(r.best?.merchant, 'Best Buy');
  assert.equal(r.bestListing?.price, 299); // the real price, not the effective one
});

test('sandbox never moves the median and wins only by being cheapest', () => {
  const real = [L('A', 300), L('B', 310), L('C', 320), L('D', 330), L('E', 340)];
  const base = scorePrice(real, product, cfgT);
  const above = scorePrice([...real, L('Sandbox Store', 305, { source: 'sandbox' })], product, cfgT);
  assert.equal(above.reference, base.reference);
  assert.equal(above.cleanedCount, 5);
  assert.equal(above.best?.merchant, 'A');
  const dropped = scorePrice([...real, L('Sandbox Store', 200, { source: 'sandbox' })], product, cfgT);
  assert.equal(dropped.best?.merchant, 'Sandbox Store');
  assert.equal(dropped.reference, base.reference);
  assert.equal(scorePrice([L('Sandbox Store', 200, { source: 'sandbox' })], product, cfgT).sub, null);
});

test('few stores: still scores, labeled limited, lower confidence', () => {
  const r = scorePrice([L('A', 300), L('B', 320)], product, cfgT);
  assert.equal(r.sub?.data_quality, 'limited');
  assert.equal(r.sub?.reason, "Only 2 new listings found, so we can't compare much");
  assert.equal(r.confidence, 0.4);
  const none = scorePrice([], product, cfgT);
  assert.equal(none.sub, null);
  assert.equal(none.confidence, 0);
});

test('about-normal and above-normal reasons', () => {
  const ls = [L('A', 325), L('B', 325), L('C', 325)];
  assert.equal(scorePrice(ls, product, cfgT).sub?.reason, '$325 is about what this sells for everywhere');
  // Risky cheap sellers are outranked by a pricier trusted one, so the best listing can sit above the median.
  const pricey = scorePrice([L('Shady One', 320, { sellerRating: 0 }), L('Shady Two', 321, { sellerRating: 0 }), L('Best Buy', 345)], product, cfgT);
  assert.equal(pricey.best?.merchant, 'Best Buy');
  assert.equal(pricey.sub?.reason, 'Best new price is $345, above the typical $321');
});

test('eBay feedback converts on a strict scale', () => {
  const e = cfg.price.ebay;
  assert.equal(ebayStars(100, 500, e), 5);
  assert.equal(ebayStars(99, 500, e), 4.6);
  assert.equal(ebayStars(97, 500, e), 3.8);
  assert.equal(ebayStars(95, 500, e), 3);
  assert.equal(ebayStars(100, 10, e), 4);
});

test('median handles even and empty inputs', () => {
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(median([]), null);
});

test('money in reasons never shows stray cents from a fractional median', () => {
  const r = scorePrice([L('A', 295.004), L('B', 296.004), L('C', 297), L('D', 298)], product, cfgT);
  assert.doesNotMatch(r.sub?.reason ?? '', /\.00\b|\.\d{3,}/);
});

test('a scam-priced listing just above half the median is dropped (live run: $150 vs a $296 median)', () => {
  const real = [L('Best Buy', 228), L('Newegg', 279), L('Adorama', 298), L('Walmart', 299.99), L('Lowes', 299.99), L('BuyDig', 339.99), L('Macys', 399.99)];
  const withScam = [...real, L('zcmp.org', 150), L('Mercari', 118), L('salla.sa', 133.24)];
  assert.deepEqual(cleanListings(withScam, product, cfg.price).listings.map((l) => l.merchant),
    real.map((l) => l.merchant));
  assert.equal(scorePrice(withScam, product, cfgT).best?.merchant, 'Best Buy');
});

test('an unknown cheaper merchant counts toward the median but cannot be the best listing', () => {
  const ls = [L('Best Buy', 228), L('Adorama', 279), L('Walmart', 298), L('Target', 299), L('Costco', 305), L('Sketchy Shop', 210)];
  const r = scorePrice(ls, product, cfg);
  assert.equal(r.best?.merchant, 'Best Buy');
  assert.equal(r.vouched, true);
  assert.equal(r.cleanedCount, 6); // the unknown seller still sets the typical price
  assert.equal(r.reference, 288.5);
  assert.equal(r.confidence, 1);
});

test('a known seller rating of 4+ vouches for a merchant, below 4 does not', () => {
  const ls = (rating: number) => [L('Best Buy', 400), L('Mid Seller', 300, { sellerRating: rating }), L('Walmart', 410), L('Target', 420), L('Costco', 430)];
  assert.equal(scorePrice(ls(4), product, cfg).best?.merchant, 'Mid Seller');
  assert.equal(scorePrice(ls(3.9), product, cfg).best?.merchant, 'Best Buy');
});

test('third-party sellers on a trusted marketplace are not trusted by name', () => {
  const ls = [L('Newegg.com - Sybershop', 250), L('Newegg.com', 299), L('Adorama', 305), L('Walmart', 310), L('Target', 320)];
  assert.equal(scorePrice(ls, product, cfg).best?.merchant, 'Newegg.com');
});

test('no vouched seller: falls back to the cheapest, labeled limited, confidence capped so Buy now cannot fire', () => {
  const ls = [L('Shop A', 250), L('Shop B', 280), L('Shop C', 290), L('Shop D', 300), L('Shop E', 310)];
  const r = scorePrice(ls, product, cfg);
  assert.equal(r.vouched, false);
  assert.equal(r.best?.merchant, 'Shop A');
  assert.equal(r.sub?.data_quality, 'limited');
  assert.equal(r.sub?.reason, "Best new price is $250 at Shop A, which we couldn't verify");
  assert.equal(r.confidence, cfg.price.unvouched_confidence_cap);
  assert.ok(r.confidence < cfg.verdict.buy_now_min_confidence);
});

test('the sandbox store is always eligible but only wins by being cheapest', () => {
  const real = [L('Best Buy', 300), L('Walmart', 310), L('Target', 320), L('Costco', 330), L('Adorama', 340)];
  assert.equal(scorePrice([...real, L('Northgate', 305, { source: 'sandbox' })], product, cfg).best?.merchant, 'Best Buy');
  assert.equal(scorePrice([...real, L('Northgate', 250, { source: 'sandbox' })], product, cfg).best?.merchant, 'Northgate');
});
