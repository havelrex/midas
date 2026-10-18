import { cleanListings, median } from '../listings/clean.js';
import { applyTrustedRetailers } from '../listings/sellerRating.js';
import type { ScoringConfig } from './config.js';
import type { BestListing, Listing, SubScore } from './types.js';
import { clamp, money } from './util.js';

export interface PriceResult {
  sub: SubScore | null;
  confidence: number; // 0..1, scales the weight in the composer
  best: Listing | null;
  bestListing: BestListing | null;
  reference: number | null;
  cleanedCount: number; // non-sandbox listings that survived cleaning
  cleaned: Listing[]; // every listing that survived cleaning, sandbox included
  vouched: boolean; // false when no seller we can vouch for sells it, so best is unverified
}

const total = (l: Listing) => l.price + l.shipping;

// Only sellers we can vouch for can be the buy target: trusted retailers (set to 5 stars) or a known rating
// at or above the minimum. The sandbox store is our own controlled listing, so it is always eligible.
export function isVouched(l: Listing, cfg: ScoringConfig['price']): boolean {
  return l.source === 'sandbox' || (l.sellerRating != null && l.sellerRating >= cfg.min_vouched_stars);
}

// Ranking only: the user sees and pays the real price, never this.
export function effectivePrice(l: Listing, riskFactor: number): number {
  const penalty = l.sellerRating == null ? 0 : l.price * riskFactor * (1 - l.sellerRating / 5);
  return l.price + l.shipping + penalty;
}

export function scorePrice(
  listings: Listing[],
  product: { model: string; name?: string },
  cfg: ScoringConfig,
): PriceResult {
  const p = cfg.price;
  const empty: PriceResult = { sub: null, confidence: 0, best: null, bestListing: null, reference: null, cleanedCount: 0, cleaned: [], vouched: false };
  const { listings: cleaned, matchedByName } = cleanListings(applyTrustedRetailers(listings, p.trusted_retailers), product, p);
  const real = cleaned.filter((l) => l.source !== 'sandbox');
  const reference = median(real.map(total));
  // The sandbox merchant never carries the price score on its own.
  if (reference == null) return empty;

  // Unknown merchants still count toward the typical price, but cannot be the buy target.
  const eligible = cleaned.filter((l) => isVouched(l, p));
  const vouched = eligible.length > 0;
  const best = [...(vouched ? eligible : cleaned)].sort((a, b) =>
    effectivePrice(a, p.risk_factor) - effectivePrice(b, p.risk_factor) || total(a) - total(b))[0];
  const bestTotal = total(best);
  const discount = (reference - bestTotal) / reference;
  const value = Math.round(clamp(50 + discount * p.score_multiplier));
  const count = real.length;

  let reason: string;
  if (!vouched) {
    reason = `Best new price is ${money(bestTotal)} at ${best.merchant}, which we couldn't verify`;
  } else if (count < p.limited_below_listings) {
    reason = `Only ${count} new ${count === 1 ? 'listing' : 'listings'} found, so we can't compare much`;
  } else if (discount >= p.about_normal_band) {
    reason = `${money(bestTotal)} at ${best.merchant}, ${Math.round(discount * 100)}% below the typical ${money(reference)} across ${count} listings`;
  } else if (discount > -p.about_normal_band) {
    reason = `${money(bestTotal)} is about what this sells for everywhere`;
  } else {
    reason = `Best new price is ${money(bestTotal)}, above the typical ${money(reference)}`;
  }

  return {
    sub: { value, reason, data_quality: !vouched || count < p.limited_below_listings || matchedByName ? 'limited' : 'ok' },
    // Never fully trust a price whose seller we could not verify, so a Buy now cannot rest on it.
    confidence: Math.min(vouched ? 1 : p.unvouched_confidence_cap, count / cfg.confidence.price_full_trust_listings),
    best,
    bestListing: { merchant: best.merchant, price: best.price, shipping: best.shipping, url: best.url },
    reference,
    cleanedCount: count,
    cleaned,
    vouched,
  };
}
