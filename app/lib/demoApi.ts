import { ApiError, apiFetch } from './apiFetch';
import { formatPrice } from './verdict';

// Hidden demo controls (EXPO_PUBLIC_DEMO_TOOLS=true, plus DEMO_MODE=true on the server). They only reach
// the server's demo routes, which are 404 when DEMO_MODE is off.
export const DEMO_TOOLS_ENABLED = process.env.EXPO_PUBLIC_DEMO_TOOLS === 'true';

const post = <T,>(path: string, itemId: string) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify({ item_id: itemId }) });

// Creates the sandbox store's offer for a saved item, so checkout can set the price watch.
export async function createDemoOffer(itemId: string): Promise<string> {
  try {
    const r = await post<{ price: number; created: boolean }>('/demo/offer', itemId);
    return r.created ? `Sandbox offer created at ${formatPrice(r.price)}.` : `Offer already exists at ${formatPrice(r.price)}.`;
  } catch (e) { return demoError(e); }
}

// Checkout's quiet version, called on every checkout open: asks the server to register the demo store's offer.
// False (never throws) when demo mode is off (404), no trusted store lists the item (409), or demo checkout
// isn't configured (503); checkout then just shows the item as not available.
export async function ensureDemoOffer(itemId: string): Promise<boolean> {
  try {
    await post<{ price: number; created: boolean }>('/demo/offer', itemId);
    return true;
  } catch (e) {
    console.warn('demo offer unavailable:', e instanceof Error ? e.message : e);
    return false;
  }
}

// Drops the sandbox store's price below the watch target: the watcher charges the card and the card refreshes.
export async function dropDemoPrice(itemId: string): Promise<string> {
  try {
    const r = await post<{ price: number; verdict: string }>('/demo/price-drop', itemId);
    return `Price dropped to ${formatPrice(r.price)}. Verdict: ${r.verdict}.`;
  } catch (e) { return demoError(e); }
}

function demoError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return 'Demo mode is off on the server, or this item was not found.';
    if (e.status === 409) return 'Not possible yet: no trusted store lists this item, or it has not been scored.';
    if (e.status === 503) return 'Demo checkout is not configured on the server.';
  }
  return 'Demo action failed. Check the server log.';
}
