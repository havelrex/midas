import type { StarBreakdown } from '../scoring/reviews.js';
import { pickReviewSource } from '../scoring/reviews.js';
import type { OwnerReview } from '../scoring/qualityExtract.js';
import type { Listing } from '../scoring/types.js';
import { titleHasModel } from './clean.js';

export class ListingsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ShoppingItem {
  listing: Listing;
  avg: number | null; // Google's product-level star rating, shown on many results
  n: number | null;
  token: string | null; // immersive_product_page_token for the detail call
}

export interface ProductDetail {
  avg: number | null;
  n: number | null;
  breakdown: StarBreakdown | null;
  reviews: OwnerReview[];
  expertSnippets: string[];
}

export interface SerpApi {
  // cacheKey names the product, so different spellings of one model share cached results.
  searchShopping(query: string, cacheKey?: string): Promise<ShoppingItem[]>;
  productDetail(token: string): Promise<ProductDetail | null>;
}

type Raw = Record<string, any>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// "Free delivery by Tue" -> 0, "$5.99 delivery" -> 5.99, anything else -> 0 (unknown is not charged).
export function parseShipping(delivery: unknown): number {
  if (typeof delivery !== 'string' || /free/i.test(delivery)) return 0;
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(delivery);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

export function toShoppingItem(raw: Raw): ShoppingItem | null {
  const price = num(raw.extracted_price);
  if (price == null || price <= 0 || typeof raw.title !== 'string' || typeof raw.source !== 'string') return null;
  // second_hand_condition ("pre-owned", ...) marks anything that is not new.
  const secondHand = typeof raw.second_hand_condition === 'string' ? raw.second_hand_condition : '';
  return {
    listing: {
      source: 'serpapi', merchant: raw.source, title: raw.title, price, shipping: parseShipping(raw.delivery),
      url: String(raw.product_link ?? raw.link ?? ''), sellerRating: null,
      condition: !secondHand ? 'new' : /refurb/i.test(secondHand) ? 'refurbished' : 'used',
    },
    avg: num(raw.rating), n: num(raw.reviews),
    token: typeof raw.immersive_product_page_token === 'string' ? raw.immersive_product_page_token : null,
  };
}

export function toProductDetail(raw: Raw): ProductDetail | null {
  const p = raw?.product_results;
  if (!p || typeof p !== 'object') return null;
  const breakdown: StarBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let found = 0;
  for (const r of Array.isArray(p.ratings) ? p.ratings : []) {
    const stars = num(r?.stars), amount = num(r?.amount);
    if (stars && amount != null && stars >= 1 && stars <= 5) { breakdown[stars as 1 | 2 | 3 | 4 | 5] = amount; found++; }
  }
  return {
    avg: num(p.rating), n: num(p.reviews), breakdown: found === 5 ? breakdown : null,
    reviews: (Array.isArray(p.user_reviews) ? p.user_reviews : [])
      .filter((r: Raw) => typeof r?.text === 'string' && num(r.rating) != null)
      .map((r: Raw) => ({ rating: r.rating as number, text: r.text as string })),
    // This response has no expert-snippet field; a source that has one would fill this in.
    expertSnippets: [],
  };
}

// The product to read reviews from: new, model number in the title, and the most reviews.
export function pickProduct(items: ShoppingItem[], model: string): ShoppingItem | null {
  const candidates = items.filter((i) => i.listing.condition === 'new' && titleHasModel(i.listing.title, model) && i.token);
  const withReviews = pickReviewSource(candidates.map((c) => ({ avg: c.avg, n: c.n, item: c })));
  return withReviews?.item ?? candidates[0] ?? null;
}

export function createSerpApi(options: { apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number }): SerpApi | undefined {
  if (!options.apiKey) return undefined;
  const fetcher = options.fetcher ?? fetch;
  async function call(params: Record<string, string>): Promise<Raw> {
    const url = new URL('https://serpapi.com/search.json');
    // SerpAPI only takes the key as a query parameter, so this URL must never be logged.
    url.search = new URLSearchParams({ gl: 'us', hl: 'en', ...params, api_key: options.apiKey! }).toString();
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
      if (!res.ok) throw new ListingsError(res.status === 429 ? 429 : 502, 'Listing search is temporarily unavailable.');
      const body = await res.json();
      if (body?.error && !/hasn't returned any results/i.test(String(body.error))) throw new ListingsError(502, 'Listing search failed.');
      return body ?? {};
    } catch (error) {
      if (error instanceof ListingsError) throw error;
      throw new ListingsError(504, 'Listing search timed out or failed.');
    }
  }
  return {
    async searchShopping(query) {
      const body = await call({ engine: 'google_shopping', q: query });
      return (Array.isArray(body.shopping_results) ? body.shopping_results : [])
        .map(toShoppingItem).filter((i: ShoppingItem | null): i is ShoppingItem => i !== null);
    },
    async productDetail(token) {
      return toProductDetail(await call({ engine: 'google_immersive_product', page_token: token }));
    },
  };
}

// Plain "brand model" returns junk marketplace results; adding the category finds real retailers.
export function buildQuery(p: { brand: string; model: string; category: string; name: string }): string {
  const parts = p.model.trim() ? [p.brand, p.model, p.category] : [p.name];
  return parts.map((s) => s.trim()).filter(Boolean).join(' ');
}
