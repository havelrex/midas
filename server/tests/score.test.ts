import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScoringConfig } from '../src/scoring/config.js';
import type { PriceResult } from '../src/scoring/price.js';
import { composeScore } from '../src/scoring/score.js';
import type { TimingResult } from '../src/scoring/timing.js';
import type { SubScore } from '../src/scoring/types.js';

const cfg = loadScoringConfig('electronics');
const sub = (value: number): SubScore => ({ value, reason: 'r', data_quality: 'ok' });
const price = (value: number | null, confidence = 1): PriceResult => ({
  sub: value == null ? null : sub(value), confidence, reference: 325, cleanedCount: 5, cleaned: [], vouched: true,
  best: null, bestListing: value == null ? null : { merchant: 'Best Buy', price: 279, shipping: 0, url: 'u' },
});
const timing = (value: number | null, confidence = 1, low = 259): TimingResult => ({
  sub: value == null ? null : sub(value), confidence, low: value == null ? null : low,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('full data: weighted sum with the configured weights', () => {
  const { output, meta } = composeScore({ quality: sub(48), reviews: sub(90), price: price(85), timing: timing(51) }, cfg);
  assert.equal(output.score, 68); // .25*48 + .2*90 + .3*85 + .25*51 = 68.25
  assert.equal(output.verdict, 'wait');
  assert.equal(output.suggested_target_price, 259);
  assert.equal(output.best_listing?.merchant, 'Best Buy');
  close(Object.values(meta.weights).reduce((a, b) => a + b, 0), 1);
});

test('null quality: reviews carries the whole item axis', () => {
  const { meta, output } = composeScore({ quality: null, reviews: sub(90), price: price(85), timing: timing(51) }, cfg);
  close(meta.weights.reviews, 0.45 / 1);
  assert.equal(meta.weights.quality, 0);
  assert.equal(output.subscores.quality, null);
});

test('null price: timing carries the deal axis and best_listing is null', () => {
  const { meta, output } = composeScore({ quality: sub(60), reviews: sub(60), price: price(null, 0), timing: timing(40) }, cfg);
  close(meta.weights.timing, 0.55);
  assert.equal(output.best_listing, null);
});

test('thin price lets timing carry more of the deal axis without shrinking the axis', () => {
  const { meta } = composeScore({ quality: sub(60), reviews: sub(60), price: price(80, 0.4), timing: timing(40, 1) }, cfg);
  assert.ok(meta.weights.timing > 0.25 && meta.weights.price < 0.3);
  close(meta.weights.price + meta.weights.timing, 0.55);
});

test('both deal sub-scores thin: the deal axis shrinks and the item axis gains', () => {
  const { meta } = composeScore({ quality: sub(60), reviews: sub(60), price: price(80, 0.4), timing: timing(40, 0.4) }, cfg);
  close(meta.weights.price + meta.weights.timing, 0.22 / 0.67);
  assert.ok(meta.weights.quality > 0.25);
});

test('a whole axis missing renormalizes across the rest', () => {
  const { meta, output } = composeScore({ quality: sub(70), reviews: sub(70), price: price(null, 0), timing: timing(null, 0) }, cfg);
  close(meta.weights.quality + meta.weights.reviews, 1);
  assert.equal(output.score, 70);
});

test('no data at all gives score 0 with every sub-score null', () => {
  const { output } = composeScore({ quality: null, reviews: null, price: price(null, 0), timing: timing(null, 0) }, cfg);
  assert.equal(output.score, 0);
  assert.deepEqual(Object.values(output.subscores), [null, null, null, null]);
});

test('buy_now is capped to wait when price or timing confidence is low', () => {
  const strong = { quality: sub(95), reviews: sub(95), price: price(95), timing: timing(95) };
  assert.equal(composeScore(strong, cfg).output.verdict, 'buy_now');
  assert.equal(composeScore(strong, cfg).output.verdict_capped, false);
  assert.equal(composeScore(strong, cfg).output.suggested_target_price, null);
  const thin = composeScore({ ...strong, price: price(95, 0.4) }, cfg);
  assert.equal(thin.output.verdict, 'wait');
  assert.equal(thin.meta.verdictCapped, true);
  assert.equal(thin.output.verdict_capped, true);
  assert.equal(thin.output.suggested_target_price, 259);
  assert.equal(composeScore({ ...strong, timing: timing(null, 0) }, cfg).output.verdict, 'wait');
});

test('skip when the score is at or below the cutoff', () => {
  assert.equal(composeScore({ quality: sub(20), reviews: sub(20), price: price(20), timing: timing(20) }, cfg).output.verdict, 'skip');
});
