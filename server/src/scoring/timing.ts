import type { ScoringConfig } from './config.js';
import type { SubScore } from './types.js';
import { clamp, money } from './util.js';

export interface PricePoint { date: string; price: number }
export interface TimingResult {
  sub: SubScore | null;
  confidence: number; // 0..1, scales the weight in the composer
  low: number | null; // 90-day low: the suggested target when the verdict is wait
}

const DAY_MS = 86_400_000;

export function scoreTiming(
  input: { today: number; history: PricePoint[]; now?: Date },
  cfg: ScoringConfig,
): TimingResult {
  const t = cfg.timing;
  // The most recent window_days entries; the seed may end a few days before "now".
  const window = [...input.history]
    .filter((p) => Number.isFinite(p.price))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-t.window_days);
  const days = window.length;
  if (days === 0) return { sub: null, confidence: 0, low: null };

  const prices = window.map((p) => p.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const { today } = input;

  let value: number;
  let position = 0; // 0 = at the low, 1 = at the high
  if (high === low) value = 50; // price never moved: no reason to wait, no reason to rush
  else {
    position = (today - low) / (high - low);
    value = 100 - position * 100;
  }

  const now = input.now ?? new Date();
  const sale = high === low ? undefined : t.sale_events.find((e) => {
    const until = (new Date(`${e.date}T00:00:00Z`).getTime() - now.getTime()) / DAY_MS;
    return until >= 0 && until <= t.sale_window_days;
  });
  if (sale && position > t.near_low_position) value -= t.sale_penalty;
  const saleApplied = Boolean(sale) && position > t.near_low_position;

  let reason: string;
  if (high === low) reason = `Price has held steady at ${money(low)} for ${days} days`;
  else if (today <= low) reason = `At its lowest price in ${t.window_days} days`;
  else {
    reason = `${money(Math.round((today - low) * 100) / 100)} above its ${t.window_days}-day low of ${money(low)}`;
    if (saleApplied) reason += `, and prices usually drop on ${sale!.name}`;
  }

  return {
    sub: { value: Math.round(clamp(value)), reason, data_quality: days < t.limited_below_days ? 'limited' : 'ok' },
    confidence: Math.min(1, days / cfg.confidence.timing_full_trust_days),
    low,
  };
}
