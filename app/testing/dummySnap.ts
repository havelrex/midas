import type { Snap } from '../features/library/useSaveSnap';
import { MOCK_ITEMS } from '../features/library/mockItems';
export const TEST_TOOLS_ENABLED = process.env.EXPO_PUBLIC_TEST_TOOLS === 'true';
const sample = MOCK_ITEMS[0];
export const DUMMY_TARGET_PRICE = sample.target_price ?? 90;
export const DUMMY_MODEL = sample.model;
export function createDummySnap(photoUri: string): Snap {
  return { photoUri, analysis: {
    category: sample.category, brand: sample.brand, model: sample.model,
    name: `[TEST] ${sample.name}`, summary: 'Shared sample data for sandbox testing only.', confidence: 1,
  }, scoreStatus: 'ready', score: {
    score: sample.score, verdict: sample.verdict, subscores: sample.subscores, best_listing: sample.best_listing,
    suggested_target_price: sample.verdict === 'wait' ? sample.target_price : null,
  } };
}
