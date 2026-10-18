// Structural mirror of shared/contracts.ts, except sub-scores and best_listing may be null
// (CLAUDE.md "Missing data"). Keeping the server build self-contained preserves dist/index.js startup.
export type DataQuality = 'ok' | 'limited';
export type Verdict = 'buy_now' | 'wait' | 'skip';

export interface Listing {
  source: 'serpapi' | 'ebay' | 'sandbox';
  merchant: string; title: string; price: number; shipping: number; url: string;
  sellerRating: number | null; // 0-5 stars, null = unknown (no penalty)
  condition: 'new' | 'used' | 'refurbished';
}

export interface SubScore { value: number; reason: string; data_quality: DataQuality }
export interface BestListing { merchant: string; price: number; shipping: number; url: string }

export interface ScoreOutput {
  score: number; verdict: Verdict;
  subscores: { quality: SubScore | null; price: SubScore | null; reviews: SubScore | null; timing: SubScore | null };
  best_listing: BestListing | null;
  suggested_target_price: number | null;
}
