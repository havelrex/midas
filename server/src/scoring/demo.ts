import type { ScoringConfig } from './config.js';
import { MERCHANT } from '../checkout/model.js';
import { appendHistory } from './priceHistory.js';
import type { Listing } from './types.js';
import { alnum, productKey as key } from './util.js';

// One fake merchant for scoring and checkout, so the card's best listing and the checkout quote name the same store.
export const SANDBOX_MERCHANT = MERCHANT;

// Demo-only: the featured product whose brand and model match (punctuation-proof), or undefined.
export function featuredProduct(cfg: ScoringConfig['demo'], p: { brand: string; model: string }) {
  const k = key(p.brand, p.model);
  return (cfg.featured_products ?? []).find((f) => key(f.brand, f.model) === k);
}

// Fills in a missing model (and brand) from a featured product's alias in the product name, so the stage item
// is not stuck in a retake loop when the vision model returns a name but no model. Otherwise returns the input.
export function normalizeFeatured<T extends { brand: string; model: string; name: string }>(cfg: ScoringConfig['demo'], a: T): T {
  if (alnum(a.model)) return a;
  const name = a.name.toLowerCase();
  const f = (cfg.featured_products ?? []).find((x) =>
    x.aliases.some((alias) => name.includes(alias.toLowerCase())) && (!alnum(a.brand) || alnum(a.brand) === alnum(x.brand)));
  return f ? { ...a, model: f.model, brand: alnum(a.brand) ? a.brand : f.brand } : a;
}

const today = () => new Date().toISOString().slice(0, 10);

// Everything DEMO_MODE controls lives here: the sandbox listing and the manual price drop.
export function createDemo(options: { cfg: ScoringConfig['demo']; historyDir?: string }) {
  const dropped = new Map<string, number>();
  const lowestReal = new Map<string, number>();
  const sandboxPrices = new Map<string, number>();
  return {
    // Priced slightly above the best real price, so a real store wins until the drop.
    // After the drop it wins only by being the cheapest; scoring code never forces it.
    // bestEffective is the best real store's ranking price; lowestTotal is the cheapest real price + shipping.
    // Demo-only exception: a featured product (see featured_products) is priced just under the cheapest real total,
    // so the sandbox wins from the first scan. It still wins only by price; ranking code has no special case.
    sandboxListing(p: { brand: string; model: string; title: string }, real: { bestEffective: number; lowestTotal: number }): Listing {
      const k = key(p.brand, p.model);
      lowestReal.set(k, real.lowestTotal);
      const featured = featuredProduct(options.cfg, p);
      const initial = featured
        ? Math.max(1, Math.min(Math.floor(real.lowestTotal * featured.sandbox_price_ratio), real.lowestTotal - 1))
        : Math.ceil(real.bestEffective * (1 + options.cfg.sandbox_markup));
      const price = dropped.get(k) ?? initial;
      sandboxPrices.set(k, price);
      return {
        source: 'sandbox', merchant: SANDBOX_MERCHANT, title: p.title, price, shipping: 0,
        url: 'https://northgate-electronics.example/checkout', sellerRating: null, condition: 'new',
      };
    },
    // True when the product is a configured demo-featured product.
    isFeatured(p: { brand: string; model: string }): boolean { return !!featuredProduct(options.cfg, p); },
    // The sandbox store's current price for a product that has been scored, or null.
    sandboxPrice(p: { brand: string; model: string }): number | null {
      return sandboxPrices.get(key(p.brand, p.model)) ?? null;
    },
    // Lowers the sandbox price below the user's target and below every real store, and records it
    // as today's history entry so reopening the item shows timing at its low.
    triggerPriceDrop(p: { brand: string; model: string }, targetPrice: number | null): number | null {
      const k = key(p.brand, p.model);
      const real = lowestReal.get(k);
      if (real == null) return null; // the item has not been scored yet
      const price = Math.max(1, Math.floor(Math.min(targetPrice ?? Infinity, real) - options.cfg.drop_undercut));
      dropped.set(k, price);
      sandboxPrices.set(k, price);
      appendHistory(p.brand, p.model, { date: today(), price }, options.historyDir);
      return price;
    },
  };
}
export type Demo = ReturnType<typeof createDemo>;
