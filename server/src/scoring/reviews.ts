import type { ScoringConfig } from './config.js';
import type { SubScore } from './types.js';
import { clamp } from './util.js';

export interface StarBreakdown { 5: number; 4: number; 3: number; 2: number; 1: number }
export interface ReviewsInput { avg: number | null; n: number | null; breakdown?: StarBreakdown | null }

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export function scoreReviews(input: ReviewsInput, cfg: ScoringConfig['reviews']): SubScore | null {
  const { avg, n, breakdown } = input;
  if (avg == null || n == null || !Number.isFinite(avg) || !Number.isFinite(n) || n <= 0 || avg <= 0) return null;

  // Thin ratings are pulled toward the category average; the user still sees the real rating.
  const trust = n / (n + cfg.trust_halfway);
  const ratingUsed = trust * avg + (1 - trust) * cfg.category_avg;
  let value = clamp(((ratingUsed - cfg.low_stars) / (cfg.high_stars - cfg.low_stars)) * 100);

  let inflated = false;
  if (breakdown) {
    const fiveShare = breakdown[5] / n;
    const middleShare = (breakdown[4] + breakdown[3] + breakdown[2]) / n;
    if (fiveShare > cfg.fake_review.five_share_min && middleShare < cfg.fake_review.middle_share_max) {
      value -= cfg.fake_review.penalty;
      inflated = true;
    }
  }

  const stars = avg.toFixed(1);
  const limited = n < cfg.limited_below_reviews;
  let reason: string;
  if (inflated) reason = `${stars} stars, but the rating pattern looks inflated`;
  else if (limited) reason = `Only ${plural(n, 'review')}, so we're treating it as average for now`;
  else if (avg < cfg.category_avg) reason = `${stars} stars across ${plural(n, 'review')}, below average for electronics`;
  else reason = `${stars} stars across ${plural(n, 'review')}`;

  return { value: Math.round(clamp(value)), reason, data_quality: limited ? 'limited' : 'ok' };
}

// Several Shopping results can describe one model; the one with the most reviews is the most reliable.
export function pickReviewSource<T extends { avg: number | null; n: number | null }>(results: T[]): T | null {
  let best: T | null = null;
  for (const r of results) {
    if (r.avg == null || r.n == null || r.n <= 0) continue;
    if (!best || r.n > (best.n as number)) best = r;
  }
  return best;
}
