import type { ScoringConfig } from './config.js';
import { MERCHANT } from '../checkout/model.js';
import { appendHistory } from './priceHistory.js';
import type { Listing } from './types.js';
import { productKey as key } from './util.js';

// One fake merchant for scoring and checkout, so the card's best listing and the checkout quote name the same store.
export const SANDBOX_MERCHANT = MERCHANT;

const today = () => new Date().toISOString().slice(0, 10);

// Everything DEMO_MODE controls lives here: the sandbox listing and the manual price drop.
export function createDemo(options: { cfg: ScoringConfig['demo']; historyDir?: string }) {
  const dropped = new Map<string, number>();
  const lowestReal = new Map<string, number>();
  const sandboxPrices = new Map<string, number>();
  return {
    // Priced slightly above the best real price, so a real store wins until the drop.
    // After the drop it wins only by being the cheapest; scoring code never forces it.
    // bestRealEffective is the best real store's ranking price; lowestRealTotal is the cheapest real price + shipping.
    sandboxListing(p: { brand: string; model: string; title: string }, real: { bestEffective: number; lowestTotal: number }): Listing {
      const k = key(p.brand, p.model);
      lowestReal.set(k, real.lowestTotal);
      const price = dropped.get(k) ?? Math.ceil(real.bestEffective * (1 + options.cfg.sandbox_markup));
      sandboxPrices.set(k, price);
      return {
        source: 'sandbox', merchant: SANDBOX_MERCHANT, title: p.title, price, shipping: 0,
        url: 'https://northgate-electronics.example/checkout', sellerRating: null, condition: 'new',
      };
    },
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
