import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ScoringConfig {
  weights: { quality: number; reviews: number; price: number; timing: number };
  verdict: { buy_now_min: number; skip_max: number; buy_now_min_confidence: number };
  confidence: { price_full_trust_listings: number; timing_full_trust_days: number };
  quality: {
    base: number; failure_multiplier: number; praise_multiplier: number; expert_con_penalty: number;
    limited_below_reviews: number; trust_halfway: number; prior_failure_rate: number; prior_praise_rate: number;
    target_reviews: { min: number; max: number }; gemini_timeout_ms: number;
  };
  reviews: {
    category_avg: number; trust_halfway: number; low_stars: number; high_stars: number;
    limited_below_reviews: number;
    fake_review: { five_share_min: number; middle_share_max: number; penalty: number };
  };
  price: {
    score_multiplier: number; clean_low_ratio: number; clean_high_ratio: number; risk_factor: number;
    limited_below_listings: number;
    ebay: { stars_per_missing_percent: number; unproven_below_feedback: number; unproven_max_stars: number };
    trusted_retailers: string[];
  };
  timing: {
    window_days: number; limited_below_days: number; sale_window_days: number; sale_penalty: number;
    near_low_position: number; sale_events: { name: string; date: string }[];
  };
}

// src/scoring and dist/scoring sit at the same depth relative to server/config.
const weightsDir = fileURLToPath(new URL('../../config/weights/', import.meta.url));

export function loadScoringConfig(category = 'electronics'): ScoringConfig {
  const file = /^[a-z0-9_-]+$/i.test(category) ? category : 'default';
  for (const name of [file, 'default']) {
    try { return JSON.parse(readFileSync(`${weightsDir}${name}.json`, 'utf8')); } catch { /* try fallback */ }
  }
  throw new Error('Scoring config missing');
}
