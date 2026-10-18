import type { ScoringConfig } from '../scoring/config.js';
import type { Listing } from '../scoring/types.js';

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const titleHasModel = (title: string, model: string) => {
  const m = norm(model);
  return m !== '' && norm(title).includes(m);
};
const total = (l: Listing) => l.price + l.shipping;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface CleanResult { listings: Listing[]; matchedByName: boolean }

// Raw results are full of cases, chargers, used units, bundles, and scams.
export function cleanListings(
  listings: Listing[],
  product: { model: string; name?: string },
  cfg: ScoringConfig['price'],
): CleanResult {
  const usable = listings.filter((l) => l.condition === 'new' && Number.isFinite(l.price) && l.price > 0);
  const model = norm(product.model);
  let matched = model ? usable.filter((l) => norm(l.title).includes(model)) : [];
  let matchedByName = false;
  if (!matched.length) {
    // No model number in any title: fall back to matching on the product name, flagged as limited.
    const words = (product.name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.length) {
      matched = usable.filter((l) => words.every((w) => l.title.toLowerCase().includes(w)));
      matchedByName = matched.length > 0;
    }
  }
  // The median that sets the bounds never includes the sandbox merchant.
  const ref = median(matched.filter((l) => l.source !== 'sandbox').map(total));
  if (ref == null) return { listings: matched.filter((l) => l.source === 'sandbox'), matchedByName };
  // Sandbox is our own controlled listing, so the accessory/bundle bounds do not apply to it.
  const kept = matched.filter((l) => l.source === 'sandbox' ||
    (total(l) >= ref * cfg.clean_low_ratio && total(l) <= ref * cfg.clean_high_ratio));
  return { listings: kept, matchedByName };
}
