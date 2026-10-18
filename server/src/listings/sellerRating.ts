import type { ScoringConfig } from '../scoring/config.js';
import { clamp } from '../scoring/util.js';
import type { Listing } from '../scoring/types.js';

// eBay feedback percentages run high, so the scale is strict.
export function ebayStars(feedbackPercent: number, feedbackCount: number, cfg: ScoringConfig['price']['ebay']): number {
  let stars = clamp(5 - (100 - feedbackPercent) * cfg.stars_per_missing_percent, 0, 5);
  if (feedbackCount < cfg.unproven_below_feedback) stars = Math.min(stars, cfg.unproven_max_stars);
  return Math.round(stars * 10) / 10;
}

// The trusted list is about reliability only; nobody gets on it by paying.
export function applyTrustedRetailers(listings: Listing[], trusted: string[]): Listing[] {
  const names = new Set(trusted.map((t) => t.toLowerCase()));
  return listings.map((l) => (names.has(l.merchant.toLowerCase()) ? { ...l, sellerRating: 5 } : l));
}
