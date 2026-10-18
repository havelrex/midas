import { cents, CheckoutError, type Offer } from '../checkout/model.js';
import type { CheckoutStore } from '../checkout/store.js';
import type { Demo } from './demo.js';
import type { ScoreProduct } from './scoreProduct.js';
import type { ScoreOutput } from './types.js';

export class DemoDropError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface DemoItem {
  id: string; user_id: string; name: string; category: string; brand: string; model: string;
  summary: string; target_price: number | null;
}
// Reads and refreshes the saved library row. The server's service role is allowed to rewrite score fields.
export interface ItemsPort {
  get(itemId: string): Promise<DemoItem | null>;
  update(itemId: string, patch: Pick<ScoreOutput, 'score' | 'verdict' | 'subscores'> & { best_listing?: ScoreOutput['best_listing'] }): Promise<void>;
}

// DEMO_MODE only. One action drives everything the demo needs, so the two price-drop mechanisms cannot disagree:
// the sandbox store's price, the offer the checkout watcher polls, the price history, and the saved card.
export function createDemoDrop(deps: {
  demo: Demo; score: ScoreProduct; items: ItemsPort; store: Pick<CheckoutStore, 'one' | 'rpc'>;
}) {
  async function owned(userId: string, itemId: string) {
    const item = await deps.items.get(itemId);
    if (!item || item.user_id !== userId) throw new DemoDropError(404, 'Item not found.');
    return item;
  }
  const analysisOf = (i: DemoItem) => ({ category: i.category, brand: i.brand, model: i.model, name: i.name, summary: i.summary, confidence: 1 });
  const register = async (item: DemoItem, dollars: number, existing: Offer | null) =>
    deps.store.rpc<Offer>('checkout_register_offer', { p_item: item.id, p_title: existing?.title ?? item.name,
      p_price: cents(Math.round(dollars * 100)), p_shipping: 0 });

  return {
    // Creates the sandbox store's offer for a saved item at its pre-drop price, so checkout becomes eligible.
    async createOffer(userId: string, itemId: string) {
      const item = await owned(userId, itemId);
      const existing = await deps.store.one<Offer>('checkout_offers', { item_id: itemId });
      if (existing) return { price: (existing.price_cents + existing.shipping_cents) / 100, created: false };
      await deps.score(analysisOf(item)); // sets the sandbox price for this product
      const price = deps.demo.sandboxPrice(item);
      if (price == null) throw new DemoDropError(409, 'No trusted store lists this item, so no sandbox offer was made.');
      await register(item, price, null);
      return { price, created: true };
    },

    // The price drop: below the user's target and every real store. Updates the offer (so the watcher can
    // charge), the price history, and the saved card (so the library and detail screen update live).
    async drop(userId: string, itemId: string, targetOverride?: number | null) {
      const item = await owned(userId, itemId);
      const watch = await deps.store.one<{ threshold_cents: number; state: string }>('checkout_watches', { item_id: itemId, user_id: userId });
      const target = targetOverride ?? (watch ? watch.threshold_cents / 100 : item.target_price);
      await deps.score(analysisOf(item)); // makes sure the cheapest real price is known, even after a restart
      const price = deps.demo.triggerPriceDrop(item, target);
      if (price == null) throw new DemoDropError(409, 'Score this item before triggering a price drop.');
      const existing = await deps.store.one<Offer>('checkout_offers', { item_id: itemId });
      const offer = await register(item, price, existing);
      const { output } = await deps.score(analysisOf(item));
      await deps.items.update(itemId, { score: output.score, verdict: output.verdict, subscores: output.subscores,
        ...(output.best_listing ? { best_listing: output.best_listing } : {}) });
      return { price, offerRevision: offer.revision, score: output.score, verdict: output.verdict };
    },
  };
}
export type DemoDrop = ReturnType<typeof createDemoDrop>;

export function createItemsPort(db: { from: (t: string) => any }): ItemsPort {
  return {
    async get(itemId) {
      const { data, error } = await db.from('items').select('id,user_id,name,category,brand,model,summary,target_price').eq('id', itemId).maybeSingle();
      if (error) throw new CheckoutError(503, 'checkout_storage_unavailable');
      return data as DemoItem | null;
    },
    async update(itemId, patch) {
      const { error } = await db.from('items').update(patch).eq('id', itemId);
      if (error) throw new CheckoutError(503, 'checkout_storage_unavailable');
    },
  };
}
