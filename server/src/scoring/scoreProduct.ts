import type { AnalysisOutput } from '../analysis/gemini.js';
import { buildQuery, ListingsError, pickProduct, type ProductDetail, type SerpApi } from '../listings/serpapi.js';
import { loadScoringConfig, type ScoringConfig } from './config.js';
import type { Demo } from './demo.js';
import { effectivePrice, scorePrice } from './price.js';
import { loadPriceHistory } from './priceHistory.js';
import type { createQualityService } from './qualityService.js';
import { scoreReviews } from './reviews.js';
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
    const items = await deps.serp.searchShopping(buildQuery(analysis),
      alnum(analysis.model) ? `product:${productKey(analysis.brand, analysis.model)}` : undefined);
    const picked = pickProduct(items, analysis.model);

    // The quality call starts as soon as the detail call returns, alongside price and timing.
    const detailPromise: Promise<ProductDetail | null> = picked?.token
      ? deps.serp.productDetail(picked.token).catch(() => null) : Promise.resolve(null);
    const qualityPromise = detailPromise.then((d) => d
      ? withTimeout(deps.quality.assess(analysis, { reviews: d.reviews, expertSnippets: d.expertSnippets, breakdown: d.breakdown }), cfg.quality.gemini_timeout_ms + 1000)
      : null).catch(() => null);

    let price = scorePrice(items.map((i) => i.listing), product, cfg);
    // The sandbox store is only added beside a real store we vouch for, so a real store wins until the drop.
    if (deps.demo && price.best && price.vouched) {
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
    const reviews = scoreReviews({
      avg: detail?.avg ?? picked?.avg ?? null, n: detail?.n ?? picked?.n ?? null, breakdown: detail?.breakdown,
    }, cfg.reviews);
    const quality = await qualityPromise;

    return composeScore({ quality, reviews, price, timing }, cfg);
  };
}
