import type { DiskCache } from '../lib/diskCache.js';
import type { ProductDetail, SerpApi, ShoppingItem } from './serpapi.js';

// Failures are never cached: errors propagate and nothing is written.
export function withCache(serp: SerpApi, cache: DiskCache): SerpApi {
  return {
    async searchShopping(query, cacheKey) {
      const key = `shopping:${cacheKey ?? query.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const hit = cache.get<ShoppingItem[]>(key);
      if (hit) return hit;
      const fresh = await serp.searchShopping(query, cacheKey);
      cache.set(key, fresh);
      return fresh;
    },
    async productDetail(token) {
      const key = `detail:${token}`;
      const hit = cache.get<ProductDetail | null>(key);
      if (hit) return hit;
      const fresh = await serp.productDetail(token);
      if (fresh) cache.set(key, fresh);
      return fresh;
    },
  };
}
