import { createApp } from './app.js';
import { createGeminiAnalyzer } from './analysis/gemini.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { withCache } from './listings/cachedSerpApi.js';
import { createSerpApi } from './listings/serpapi.js';
import { createDiskCache } from './lib/diskCache.js';
import { createUserVerifier } from './middleware/requireUser.js';
import { createCheckout } from './checkout/createCheckout.js';
import { startCheckoutWatcher } from './checkout/watcher.js';
import { loadScoringConfig } from './scoring/config.js';
import { createCheckoutStore } from './checkout/store.js';
import { createSupabaseAdmin } from './lib/supabaseAdmin.js';
import { createDemo } from './scoring/demo.js';
import { createDemoDrop, createItemsPort } from './scoring/demoDrop.js';
import { createGeminiGenerate } from './scoring/qualityExtract.js';
import { createQualityService } from './scoring/qualityService.js';
import { createScorer } from './scoring/scoreProduct.js';

try {
  const config = loadConfig();
  const checkout = createCheckout(config);
  if (!checkout) console.info('Sandbox checkout is disabled: payment configuration is incomplete.');
  const scoring = loadScoringConfig('electronics');
  const demo = config.demoMode ? createDemo({ cfg: scoring.demo }) : undefined;
  const cache = createDiskCache({ ttlMs: (config.cacheTtlMinutes ?? 60) * 60_000 });
  const serp = createSerpApi({ apiKey: config.serpApiKey });
  const quality = createQualityService({
    cfg: scoring.quality, cache,
    generate: createGeminiGenerate({ apiKey: config.geminiApiKey, model: config.geminiModel!, timeoutMs: scoring.quality.gemini_timeout_ms }),
  });
  const score = createScorer({ serp: serp && withCache(serp, cache), quality, demo });
  // The demo drop also needs the database (service role) to update the checkout offer and the saved card.
  const demoDrop = demo && config.supabaseServiceRoleKey ? (() => {
    const db = createSupabaseAdmin(config);
    return createDemoDrop({ demo, score, items: createItemsPort(db), store: createCheckoutStore(db) });
  })() : undefined;
  const app = createApp({ verifyToken: createUserVerifier(config),
    checkout,
    analyze: createGeminiAnalyzer({ apiKey: config.geminiApiKey, model: config.geminiModel }),
    score, demo, demoDrop });
  let stopping = false;
  let stopWatcher: () => Promise<void> = async () => {};
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`Midas API listening on port ${config.port}`);
    if (!stopping && checkout && config.checkoutWatcherEnabled) stopWatcher = startCheckoutWatcher(checkout);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    void stopWatcher();
    console.error(error.code === 'EADDRINUSE'
      ? `PORT ${config.port} is already in use`
      : 'Unable to start API server');
    process.exitCode = 1;
  });

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.info('Stopping Midas API server');
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10_000);
    timeout.unref();
    const drained = new Promise<void>((resolve) => server.close((error) => {
      process.exitCode = error ? 1 : 0;
      resolve();
    }));
    void Promise.all([stopWatcher(), drained]).then(() => clearTimeout(timeout));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message : 'Unable to initialize API server');
  process.exitCode = 1;
}
