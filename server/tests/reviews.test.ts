import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScoringConfig } from '../src/scoring/config.js';
import { pickReviewSource, scoreReviews } from '../src/scoring/reviews.js';

const cfg = loadScoringConfig('electronics').reviews;

test('matches the spec table at large review counts', () => {
  assert.equal(scoreReviews({ avg: 4.9, n: 100000 }, cfg)?.value, 100);
  assert.equal(scoreReviews({ avg: 4.7, n: 5000 }, cfg)?.value, 90);
  assert.equal(scoreReviews({ avg: 3.5, n: 100000 }, cfg)?.value, 0);
});

test('few reviews cannot beat many: 3 five-star reviews vs 5000 at 4.7', () => {
  const few = scoreReviews({ avg: 5, n: 3 }, cfg)!;
  const many = scoreReviews({ avg: 4.7, n: 5000 }, cfg)!;
  assert.ok(few.value < many.value);
  assert.equal(few.data_quality, 'limited');
  assert.equal(few.reason, "Only 3 reviews, so we're treating it as average for now");
});

test('shows the real rating and count, never the adjusted one', () => {
  assert.equal(scoreReviews({ avg: 4.7, n: 5000 }, cfg)?.reason, '4.7 stars across 5,000 reviews');
  assert.equal(scoreReviews({ avg: 3.9, n: 800 }, cfg)?.reason, '3.9 stars across 800 reviews, below average for electronics');
  assert.equal(scoreReviews({ avg: 5, n: 1 }, cfg)?.reason, "Only 1 review, so we're treating it as average for now");
});

test('fake-review penalty only runs with a breakdown and a skewed pattern', () => {
  const skewed = { 5: 960, 4: 10, 3: 10, 2: 10, 1: 10 };
  const healthy = { 5: 700, 4: 150, 3: 80, 2: 40, 1: 30 };
  const plain = scoreReviews({ avg: 4.9, n: 1000 }, cfg)!;
  const flagged = scoreReviews({ avg: 4.9, n: 1000, breakdown: skewed }, cfg)!;
  assert.equal(plain.value - flagged.value, cfg.fake_review.penalty);
  assert.equal(flagged.reason, '4.9 stars, but the rating pattern looks inflated');
  assert.equal(scoreReviews({ avg: 4.9, n: 1000, breakdown: healthy }, cfg)!.value, plain.value);
});

test('returns null when there is no rating', () => {
  for (const input of [{ avg: null, n: null }, { avg: 4.5, n: 0 }, { avg: null, n: 10 }]) {
    assert.equal(scoreReviews(input, cfg), null);
  }
});

test('constants come from config', () => {
  const skeptical = { ...cfg, trust_halfway: 3000 };
  assert.notEqual(scoreReviews({ avg: 4.8, n: 300 }, cfg)!.value, scoreReviews({ avg: 4.8, n: 300 }, skeptical)!.value);
});

test('picks the Shopping result with the most reviews', () => {
  const picked = pickReviewSource([{ avg: 4.9, n: 12 }, { avg: 4.5, n: 900 }, { avg: null, n: null }]);
  assert.deepEqual(picked, { avg: 4.5, n: 900 });
  assert.equal(pickReviewSource([{ avg: null, n: null }]), null);
});
