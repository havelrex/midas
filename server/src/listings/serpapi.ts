import type { StarBreakdown } from '../scoring/reviews.js';
import type { OwnerReview } from '../scoring/qualityExtract.js';
import type { Listing } from '../scoring/types.js';
import { titleHasModel } from './clean.js';

export const mergeItems = (a: ShoppingItem[], b: ShoppingItem[]): ShoppingItem[] => {
  const seen = new Set(a.map((i) => `${i.listing.merchant}|${i.listing.title}|${i.listing.price}`));
  return [...a, ...b.filter((i) => !seen.has(`${i.listing.merchant}|${i.listing.title}|${i.listing.price}`))];
};

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
  // More owner reviews than Google's detail call gives (about 6): Walmart's lowest-rated and highest-rated pages.
  productReviews(brand: string, model: string, cacheKey?: string): Promise<OwnerReview[]>;
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
// Picks the product page to read ratings and reviews from. Cards for one product carry the same big review count,
// but each card's average can differ a lot (an eBay seller's card showed 3.7 stars for a 4.5-star headphone), and a
// single seller's card can have a handful of ratings. So: keep the main cards (at least half the largest review count),
// take the median rating among them, and use the trusted-retailer card closest to it (any main card if none is trusted).
export function pickProduct(items: ShoppingItem[], model: string, trusted: string[] = []): ShoppingItem | null {
  const all = items.filter((i) => i.listing.condition === 'new' && titleHasModel(i.listing.title, model) && i.token);
  const rated = all.filter((i) => i.avg != null && i.n != null && i.n > 0);
  if (!rated.length) return all[0] ?? null;
  const biggest = Math.max(...rated.map((i) => i.n as number));
  const main = rated.filter((i) => (i.n as number) >= biggest / 2);
  const ratings = main.map((i) => i.avg as number).sort((a, b) => a - b);
  const mid = Math.floor(ratings.length / 2);
  const median = ratings.length % 2 ? ratings[mid] : (ratings[mid - 1] + ratings[mid]) / 2;
  const names = new Set(trusted.map((t) => t.toLowerCase()));
  const pool = main.filter((i) => names.has(i.listing.merchant.toLowerCase()));
  return [...(pool.length ? pool : main)].sort((a, b) =>
    Math.abs((a.avg as number) - median) - Math.abs((b.avg as number) - median) || (b.n as number) - (a.n as number))[0];
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
    async productReviews(brand, model) {
      const search = await call({ engine: 'walmart', query: `${brand} ${model}`.trim() });
      const id = pickWalmartProduct(Array.isArray(search.organic_results) ? search.organic_results : [], model);
      if (!id) return [];
      // Lowest-rated first, because that is where failures show up; highest-rated for what lasted.
      const pages = await Promise.all(['rating-asc', 'rating-desc'].map((sort) =>
        call({ engine: 'walmart_product_reviews', product_id: id, sort }).catch((): Raw => ({}))));
      return toWalmartReviews(pages.flatMap((p) => (Array.isArray(p.reviews) ? p.reviews : [])));
    },
  };
}

// The Walmart listing with the most ratings that is new, not restored or open-box, and matches the model.
export function pickWalmartProduct(results: Raw[], model: string): string | null {
  const usable = results.filter((r) => typeof r.title === 'string' && titleHasModel(r.title, model)
    && !/restored|refurb|open[ -]?box|used|pre-?owned|renewed|for parts/i.test(r.title) && num(r.reviews) != null && r.reviews > 0 && r.us_item_id);
  usable.sort((a, b) => (b.reviews as number) - (a.reviews as number));
  return usable[0] ? String(usable[0].us_item_id) : null;
}

export function toWalmartReviews(raw: Raw[]): OwnerReview[] {
  const seen = new Set<string>();
  const out: OwnerReview[] = [];
  for (const r of raw) {
    const rating = num(r?.rating);
    const text = [r?.title, r?.text].filter((t) => typeof t === 'string' && t.trim()).join('. ').trim();
    if (rating == null || rating < 1 || rating > 5 || !text || seen.has(text)) continue;
    seen.add(text);
    out.push({ rating, text });
  }
  return out;
}

// Google's results for the same words change from run to run, and a discontinued model may show no trusted store
// at all. When the first search finds none, these other wordings are tried and merged (each one cached on its own).
export function buildFallbackQueries(p: { brand: string; model: string; category: string; name: string }): string[] {
  if (!p.model.trim()) return [];
  const base = [p.brand, p.model].map((s) => s.trim()).filter(Boolean).join(' ');
  return [`${base} wireless ${p.category.trim()}`.trim(), `${base} ${p.category.trim()} new`.trim()];
}

// Plain "brand model" returns junk marketplace results; adding the category finds real retailers.
export function buildQuery(p: { brand: string; model: string; category: string; name: string }): string {
  const parts = p.model.trim() ? [p.brand, p.model, p.category] : [p.name];
  return parts.map((s) => s.trim()).filter(Boolean).join(' ');
}
