import type { ScoringConfig } from './config.js';
import type { SubScore } from './types.js';
import { clamp } from './util.js';

// Gemini only counts what reviewers report. It never rates the product or writes a reason.
// `reviews_read` is set in code because models miscount long lists.
export interface QualitySignals {
  failure_mentions: number;
  early_failure_mentions: number;
  durability_praise: number;
  expert_reliability_cons: number;
  evidence_quote: string;
  reviews_read: number;
  // Set in code. The sample reads 1 to 3 star reviews first, so it is skewed toward failures.
  // When both shares are known, rates are reweighted to the real star mix before shrinking.
  sample_low_share?: number | null; // share of the reviews read that are 1 to 3 stars
  population_low_share?: number | null; // share of all ratings that are 1 to 3 stars
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function scoreQuality(s: QualitySignals, cfg: ScoringConfig['quality']): SubScore | null {
  const n = s.reviews_read;
  if (!(n > 0)) return null;

  // Failures are reported in low-star reviews and praise in high-star ones, so each rate is rescaled
  // from the sample's star mix to the real one. Skipped when either mix is unknown.
  let failureObserved = (s.failure_mentions + s.early_failure_mentions) / n; // early failures count twice
  let praiseObserved = s.durability_praise / n;
  const sampleLow = s.sample_low_share, popLow = s.population_low_share;
  if (sampleLow != null && popLow != null) {
    if (sampleLow > 0) failureObserved = Math.min(1, failureObserved * (popLow / sampleLow));
    if (sampleLow < 1) praiseObserved = Math.min(1, praiseObserved * ((1 - popLow) / (1 - sampleLow)));
  }

  // Thin data is pulled toward a typical electronics rate so one mention cannot swing the score.
  const trust = n / (n + cfg.trust_halfway);
  const failureRate = trust * failureObserved + (1 - trust) * cfg.prior_failure_rate;
  const praiseRate = trust * praiseObserved + (1 - trust) * cfg.prior_praise_rate;
  const value = Math.round(clamp(
    cfg.base - failureRate * cfg.failure_multiplier + praiseRate * cfg.praise_multiplier
      - s.expert_reliability_cons * cfg.expert_con_penalty));

  const limited = n < cfg.limited_below_reviews;
  const quote = s.evidence_quote.trim();
  let reason: string;
  if (limited) reason = `Only ${plural(n, 'review')} to go on, so this is a rough estimate`;
  else if (s.early_failure_mentions > 0) {
    // The reviews read lean toward failures, so this says "reviews we read" and never claims a share of owners.
    reason = `${s.early_failure_mentions} of the ${n} reviews we read ${s.early_failure_mentions === 1 ? 'mentions' : 'mention'} failure within 6 months` + (quote ? `, including "${quote}"` : '');
  } else if (s.expert_reliability_cons > 0 && s.failure_mentions === 0) {
    reason = `Experts flag ${plural(s.expert_reliability_cons, 'reliability concern')}`;
  } else {
    const failures = s.failure_mentions > 0
      ? `${s.failure_mentions} of the ${n} reviews we read ${s.failure_mentions === 1 ? 'mentions' : 'mention'} a failure`
      : `None of the ${n} reviews we read mention a failure`;
    reason = failures + (s.durability_praise > 0 ? `, and ${s.durability_praise} say it has held up` : '');
  }
  return { value, reason, data_quality: limited ? 'limited' : 'ok' };
}
