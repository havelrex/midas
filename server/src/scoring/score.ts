import type { ScoringConfig } from './config.js';
import type { PriceResult } from './price.js';
import type { TimingResult } from './timing.js';
import type { ScoreOutput, SubScore, Verdict } from './types.js';

type Key = 'quality' | 'reviews' | 'price' | 'timing';
const KEYS: Key[] = ['quality', 'reviews', 'price', 'timing'];

export interface ComposeInput {
  quality: SubScore | null;
  reviews: SubScore | null;
  price: PriceResult;
  timing: TimingResult;
}

export interface ComposeMeta {
  confidence: Record<Key, number>;
  weights: Record<Key, number>; // effective weights, sum to 1 unless no data
  verdictCapped: boolean; // buy_now was downgraded to wait for thin price or timing data
}

// Within an axis, each sub-score's share follows base weight x confidence, so a thin price lets timing
// carry more. The axis itself keeps its full weight if any member is fully trusted and shrinks with its
// best member's confidence otherwise. An axis with nothing usable drops out and the rest renormalize.
function effectiveWeights(base: ScoringConfig['weights'], conf: Record<Key, number>): Record<Key, number> {
  const out: Record<Key, number> = { quality: 0, reviews: 0, price: 0, timing: 0 };
  for (const axis of [['quality', 'reviews'], ['price', 'timing']] as Key[][]) {
    const eff = axis.map((k) => base[k] * conf[k]);
    const sum = eff.reduce((a, b) => a + b, 0);
    if (sum === 0) continue;
    const axisWeight = axis.reduce((a, k) => a + base[k], 0) * Math.max(...axis.map((k) => conf[k]));
    axis.forEach((k, i) => { out[k] = axisWeight * (eff[i] / sum); });
  }
  const total = KEYS.reduce((a, k) => a + out[k], 0);
  if (total > 0) for (const k of KEYS) out[k] /= total;
  return out;
}

export function composeScore(input: ComposeInput, cfg: ScoringConfig): { output: ScoreOutput; meta: ComposeMeta } {
  const subs: Record<Key, SubScore | null> = {
    quality: input.quality, reviews: input.reviews, price: input.price.sub, timing: input.timing.sub,
  };
  const confidence: Record<Key, number> = {
    quality: input.quality ? 1 : 0,
    reviews: input.reviews ? 1 : 0,
    price: input.price.sub ? input.price.confidence : 0,
    timing: input.timing.sub ? input.timing.confidence : 0,
  };
  const weights = effectiveWeights(cfg.weights, confidence);
  const score = Math.round(KEYS.reduce((a, k) => a + weights[k] * (subs[k]?.value ?? 0), 0));

  let verdict: Verdict = score >= cfg.verdict.buy_now_min ? 'buy_now' : score <= cfg.verdict.skip_max ? 'skip' : 'wait';
  // Buy now claims the price is at or near its low, so it never fires on thin price or timing data.
  const floor = cfg.verdict.buy_now_min_confidence;
  const verdictCapped = verdict === 'buy_now' && (confidence.price < floor || confidence.timing < floor);
  if (verdictCapped) verdict = 'wait';

  return {
    output: {
      score, verdict, subscores: subs,
      best_listing: input.price.bestListing,
      suggested_target_price: verdict === 'wait' ? input.timing.low : null,
      verdict_capped: verdictCapped,
    },
    meta: { confidence, weights, verdictCapped },
  };
}
