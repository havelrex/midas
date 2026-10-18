import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScoringConfig } from '../src/scoring/config.js';
import { clamp } from '../src/scoring/util.js';

test('electronics weights sum to 1', () => {
  const { weights } = loadScoringConfig('electronics');
  assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('unknown or unsafe category falls back to default', () => {
  assert.deepEqual(loadScoringConfig('clothes'), loadScoringConfig('default'));
  assert.deepEqual(loadScoringConfig('../../etc/passwd'), loadScoringConfig('default'));
});

test('clamp bounds to 0-100', () => {
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(130), 100);
  assert.equal(clamp(42), 42);
});

test('confidence and quality-prior constants are configured', () => {
  const cfg = loadScoringConfig('electronics');
  assert.ok(cfg.confidence.price_full_trust_listings > 0 && cfg.confidence.timing_full_trust_days > 0);
  assert.ok(cfg.quality.trust_halfway > 0 && cfg.quality.prior_failure_rate >= 0);
  assert.ok(cfg.verdict.buy_now_min_confidence > 0 && cfg.verdict.buy_now_min_confidence <= 1);
});
