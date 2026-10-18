import type { SubScores, Verdict } from '../../shared/contracts';
import { verdictColors } from './theme';

// Display labels differ from the enum so a verdict never reads like the "Buy now" purchase button.
// `color` is a fill/ring color: put black text on it, never use it as text on white.
export const VERDICT_DISPLAY: Record<Verdict, { label: string; color: string }> = {
  buy_now: { label: 'Good buy', color: verdictColors.good },
  wait: { label: 'Wait', color: verdictColors.caution },
  skip: { label: 'Skip', color: verdictColors.bad },
};

// The one-line "why" under a verdict: the strongest sub-score for a good buy, the weakest otherwise.
export function verdictReason(verdict: Verdict, subscores: SubScores): string {
  const subs = Object.values(subscores).sort((a, b) => a.value - b.value);
  return (verdict === 'buy_now' ? subs[subs.length - 1] : subs[0]).reason;
}

export function formatPrice(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, '')}`;
}
