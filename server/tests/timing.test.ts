import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadScoringConfig } from '../src/scoring/config.js';
import { appendHistory, loadPriceHistory } from '../src/scoring/priceHistory.js';
import { scoreTiming, type PricePoint } from '../src/scoring/timing.js';

const cfg = loadScoringConfig('electronics');
const julyNow = new Date('2026-07-01T00:00:00Z'); // no sale event within 6 weeks
const series = (prices: number[]): PricePoint[] =>
  prices.map((price, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), price }));
const spread = (days: number, low: number, high: number) =>
  series(Array.from({ length: days }, (_, i) => (i === 3 ? low : i === 7 ? high : high)));

test('spec worked example: low 259, high 329, today 279 -> 71', () => {
  const r = scoreTiming({ today: 279, history: spread(90, 259, 329), now: julyNow }, cfg);
  assert.equal(r.sub?.value, 71);
  assert.equal(r.sub?.reason, '$20 above its 90-day low of $259');
  assert.equal(r.low, 259);
  assert.equal(r.confidence, 1);
});

test('clamps at the low and the high, and a new low scores 100', () => {
  const h = spread(90, 259, 329);
  assert.equal(scoreTiming({ today: 259, history: h, now: julyNow }, cfg).sub?.value, 100);
  assert.equal(scoreTiming({ today: 249, history: h, now: julyNow }, cfg).sub?.value, 100);
  assert.equal(scoreTiming({ today: 249, history: h, now: julyNow }, cfg).sub?.reason, 'At its lowest price in 90 days');
  assert.equal(scoreTiming({ today: 329, history: h, now: julyNow }, cfg).sub?.value, 0);
  assert.equal(scoreTiming({ today: 400, history: h, now: julyNow }, cfg).sub?.value, 0);
});

test('flat history scores 50 and says so', () => {
  const r = scoreTiming({ today: 299, history: series(Array(90).fill(299)), now: julyNow }, cfg);
  assert.equal(r.sub?.value, 50);
  assert.equal(r.sub?.reason, 'Price has held steady at $299 for 90 days');
});

test('sale within six weeks subtracts 20 unless today is near the low', () => {
  const h = spread(90, 259, 329);
  const octNow = new Date('2026-10-18T00:00:00Z'); // Black Friday is 40 days away
  const r = scoreTiming({ today: 279, history: h, now: octNow }, cfg);
  assert.equal(r.sub?.value, 51);
  assert.equal(r.sub?.reason, '$20 above its 90-day low of $259, and prices usually drop on Black Friday');
  assert.equal(scoreTiming({ today: 262, history: h, now: octNow }, cfg).sub?.reason, '$3 above its 90-day low of $259');
  assert.equal(scoreTiming({ today: 262, history: h, now: octNow }, cfg).sub?.value, 96);
});

test('thin history lowers confidence and labels limited; none gives null', () => {
  const short = scoreTiming({ today: 279, history: spread(10, 259, 329), now: julyNow }, cfg);
  assert.equal(short.sub?.data_quality, 'limited');
  assert.ok(Math.abs(short.confidence - 10 / 30) < 1e-9);
  const none = scoreTiming({ today: 279, history: [], now: julyNow }, cfg);
  assert.equal(none.sub, null);
  assert.equal(none.confidence, 0);
});

test('history store round-trips, appends today, and ignores unknown items', () => {
  const dir = mkdtempSync(`${tmpdir()}/hist-`) + '/';
  assert.deepEqual(loadPriceHistory('Sony', 'WH-1000XM5', dir), []);
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-18', price: 300 }, dir);
  appendHistory('Sony', 'WH-1000XM5', { date: '2026-10-18', price: 250 }, dir);
  assert.deepEqual(loadPriceHistory('Sony', 'WH-1000XM5', dir), [{ date: '2026-10-18', price: 250 }]);
});

test('seeded stage-item history is 90 days with the expected low and high', () => {
  const h = loadPriceHistory('Sony', 'WH-1000XM5');
  assert.equal(h.length, 90);
  assert.equal(Math.min(...h.map((p) => p.price)), 229);
  assert.equal(Math.max(...h.map((p) => p.price)), 329);
});
