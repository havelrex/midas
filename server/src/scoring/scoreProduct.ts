import type { AnalysisOutput } from '../analysis/gemini.js';
import { buildFallbackQueries, buildQuery, ListingsError, mergeItems, pickProduct, type ProductDetail, type SerpApi } from '../listings/serpapi.js';
import { loadScoringConfig, type ScoringConfig } from './config.js';
import type { Demo } from './demo.js';
import { effectivePrice, scorePrice } from './price.js';
import { loadPriceHistory } from './priceHistory.js';
import type { createQualityService } from './qualityService.js';
import { pickReviewSource, scoreReviews } from './reviews.js';
import { composeScore, type ComposeMeta } from './score.js';
import { scoreTiming } from './timing.js';
import type { Listing, ScoreOutput } from './types.js';
import { alnum, productKey } from './util.js';

export interface ScorerDeps {
  serp?: SerpApi;
  quality: ReturnType<typeof createQualityService>;
  demo?: Demo; // present only in DEMO_MODE
  historyDir?: string;
  now?: () => Date;
}
export type ScoreProduct = (analysis: AnalysisOutput) => Promise<{ output: ScoreOutput; meta: ComposeMeta }>;

const total = (l: Listing) => l.price + l.shipping;
// Never block the score card on a slow call: a timeout counts as no data.
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(resolve, ms, null).unref())]);

export function createScorer(deps: ScorerDeps): ScoreProduct {
  return async (analysis) => {
    if (!deps.serp) throw new ListingsError(503, 'Listing search is not configured.');
    // Electronics is the demo category; other categories fall back to the same default weights.
    const cfg: ScoringConfig = loadScoringConfig('electronics');
    const product = { model: analysis.model, name: analysis.name };

    // Keyed by product, not by query text, so "WH-1000XM5" and "WH1000XM5" read the same results.
    const cacheKey = alnum(analysis.model) ? `product:${productKey(analysis.brand, analysis.model)}` : undefined;
    let items = await deps.serp.searchShopping(buildQuery(analysis), cacheKey);
    // No trusted store in the results: try other wordings and merge, because the same search can return different stores.
    const fallbacks = buildFallbackQueries(analysis);
    for (let i = 0; i < fallbacks.length && !scorePrice(items.map((x) => x.listing), product, cfg).vouched; i++) {
      const more = await deps.serp.searchShopping(fallbacks[i], cacheKey && `${cacheKey}:q${i + 2}`).catch(() => []);
      items = mergeItems(items, more);
    }
    const picked = pickProduct(items, analysis.model, cfg.price.trusted_retailers);

    // The quality call starts as soon as the detail call returns, alongside price and timing.
    const detailPromise: Promise<ProductDetail | null> = picked?.token
      ? deps.serp.productDetail(picked.token).catch(() => null) : Promise.resolve(null);
    const qualityPromise = detailPromise.then(async (d) => {
      if (!d) return null;
      let reviews = d.reviews;
      // Google's detail call returns about 6 reviews. Below the threshold, top up with Walmart's, then merge.
      if (reviews.length < cfg.quality.fallback_below_reviews) {
        const more = await deps.serp!.productReviews(analysis.brand, analysis.model, cacheKey).catch(() => []);
        const seen = new Set(reviews.map((r) => r.text));
        reviews = [...reviews, ...more.filter((r) => !seen.has(r.text))];
      }
      return withTimeout(deps.quality.assess(analysis, { reviews, expertSnippets: d.expertSnippets, breakdown: d.breakdown }), cfg.quality.gemini_timeout_ms + 1000);
    }).catch(() => null);

    let price = scorePrice(items.map((i) => i.listing), product, cfg);
    // The sandbox store is only added beside a real store we vouch for, so a real store wins until the drop.
    // Demo-only exception: a featured product gets it whenever any cleaned real listing exists (it then wins by price).
    const featured = !!deps.demo?.isFeatured(analysis);
    if (deps.demo && price.best && (price.vouched || featured)) {
      const real = price.cleaned.filter((l) => l.source !== 'sandbox');
      const sandbox = deps.demo.sandboxListing(
        { brand: analysis.brand, model: analysis.model, title: picked?.listing.title ?? analysis.name },
        { bestEffective: effectivePrice(price.best, cfg.price.risk_factor), lowestTotal: Math.min(...real.map(total)) });
      price = scorePrice([...items.map((i) => i.listing), sandbox], product, cfg);
    }

    const history = loadPriceHistory(analysis.brand, analysis.model, deps.historyDir);
    const timing = price.best
      ? scoreTiming({ today: total(price.best), history, now: deps.now?.() }, cfg)
      : { sub: null, confidence: 0, low: null };

    const detail = await detailPromise;
    // Detail call first; otherwise the Shopping result for this model with the most reviews.
    const source = pickReviewSource(items);
    const reviews = scoreReviews({
      avg: detail?.avg ?? picked?.avg ?? source?.avg ?? null,
      n: detail?.n ?? picked?.n ?? source?.n ?? null,
      breakdown: detail?.breakdown,
    }, cfg.reviews);
    const quality = await qualityPromise;

    return composeScore({ quality, reviews, price, timing }, cfg);
  };
}
