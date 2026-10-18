import type { Snap } from '../features/library/useSaveSnap';

export const TEST_TOOLS_ENABLED = process.env.EXPO_PUBLIC_TEST_TOOLS === 'true';
export const DUMMY_TARGET_PRICE = 90;

// Intentionally fictional; never use these numbers as real shopping evidence.
export function createDummySnap(photoUri: string): Snap {
  return {
    photoUri,
    analysis: {
      category: 'Headphones', brand: 'Midas Test', model: 'TEST-HEADPHONES-001',
      name: '[TEST] Midas Demo Headphones',
      summary: 'Fictional test item with fixed prices and scores. No real product or purchase.',
      confidence: 1,
    },
    scoreStatus: 'ready',
    score: {
      score: 78, verdict: 'wait',
      subscores: {
        quality: { value: 85, reason: 'Test fixture: favorable durability evidence.' },
        price: { value: 70, reason: 'Test fixture: $120 is above the $90 target.' },
        reviews: { value: 90, reason: 'Test fixture: strong review evidence.' },
        timing: { value: 67, reason: 'Test fixture: wait for a simulated price drop.' },
      },
      best_listing: { merchant: 'Midas Test Merchant', price: 120, shipping: 0,
        url: 'https://example.invalid/midas-test-headphones' },
    },
  };
}
