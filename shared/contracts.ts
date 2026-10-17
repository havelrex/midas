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

export interface SubScore {
  value: number; // 0..100
  reason: string; // one-line explanation shown on the detail screen
}

export interface SubScores {
  quality: SubScore;
  price: SubScore;
  reviews: SubScore;
  timing: SubScore;
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
  best_listing: BestListing;
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
