// Team contracts. Lock these in the first hour; stub against them freely.

// 1. Analysis output (Caleb -> Havel)
export interface AnalysisOutput {
  category: string;
  brand: string;
  model: string;
  name: string;
  summary: string;
  confidence: number; // 0..1
}

// 2. Score output (Havel -> everyone)
export type Verdict = 'buy_now' | 'wait' | 'skip';

export type DataQuality = 'ok' | 'limited';

export interface SubScore {
  value: number; // 0..100
  reason: string; // one-line explanation shown on the detail screen
  data_quality: DataQuality;
}

// A sub-score that can't be computed is null. UI must handle null.
export interface SubScores {
  quality: SubScore | null;
  price: SubScore | null;
  reviews: SubScore | null;
  timing: SubScore | null;
}

export interface BestListing {
  merchant: string;
  price: number;
  shipping: number;
  url: string;
}

export interface ScoreOutput {
  score: number; // 0..100
  verdict: Verdict;
  subscores: SubScores;
  best_listing: BestListing | null; // null when no trusted-or-cleaned listing exists; such a score cannot be saved
  suggested_target_price: number | null; // 90-day low when verdict is 'wait', else null
  // true when a Buy now was downgraded to Wait because price or timing data was too thin to trust.
  verdict_capped?: boolean;
}

// 3. Library item (Stanley -> everyone): one row in public.items
export type CheckoutStatus = 'none' | 'watching' | 'purchased';

export interface LibraryItem {
  id: string;
  user_id: string;
  created_at: string; // ISO timestamp
  thumbnail_url: string;
  name: string;
  summary: string;
  score: number;
  subscores: SubScores;
  category: string;
  brand: string;
  model: string;
  verdict: Verdict;
  best_listing: BestListing;
  target_price: number | null;
  checkout_status: CheckoutStatus;
}
