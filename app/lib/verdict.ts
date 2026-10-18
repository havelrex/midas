import type { SubScores, Verdict } from '../../shared/contracts';
import { colors } from './theme';

// Display labels differ from the enum so a verdict never reads like the "Buy now" purchase button.
export const VERDICT_DISPLAY: Record<Verdict, { label: string; color: string }> = {
  buy_now: { label: 'Good buy', color: colors.good },
  wait: { label: 'Wait', color: colors.caution },
  skip: { label: 'Skip', color: colors.destructive },
};

// The one-line "why" under a verdict: the strongest sub-score for a good buy, the weakest otherwise.
export function verdictReason(verdict: Verdict, subscores: SubScores): string {
  const subs = Object.values(subscores).sort((a, b) => a.value - b.value);
  return (verdict === 'buy_now' ? subs[subs.length - 1] : subs[0]).reason;
}

export function formatPrice(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, '')}`;
}
