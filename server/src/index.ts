import { createApp } from './app.js';
import { createGeminiAnalyzer } from './analysis/gemini.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { withCache } from './listings/cachedSerpApi.js';
import { createSerpApi } from './listings/serpapi.js';
import { createDiskCache } from './lib/diskCache.js';
import { createUserVerifier } from './middleware/requireUser.js';
import { loadScoringConfig } from './scoring/config.js';
import { createDemo } from './scoring/demo.js';
import { createGeminiGenerate } from './scoring/qualityExtract.js';
import { createQualityService } from './scoring/qualityService.js';
import { createScorer } from './scoring/scoreProduct.js';

try {
  const config = loadConfig();
  const scoring = loadScoringConfig('electronics');
  const demo = config.demoMode ? createDemo({ cfg: scoring.demo }) : undefined;
  const cache = createDiskCache({ ttlMs: (config.cacheTtlMinutes ?? 60) * 60_000 });
  const serp = createSerpApi({ apiKey: config.serpApiKey });
  const quality = createQualityService({
    cfg: scoring.quality, cache,
    generate: createGeminiGenerate({ apiKey: config.geminiApiKey, model: config.geminiModel!, timeoutMs: scoring.quality.gemini_timeout_ms }),
  });
  const app = createApp({ verifyToken: createUserVerifier(config),
    analyze: createGeminiAnalyzer({ apiKey: config.geminiApiKey, model: config.geminiModel }),
    score: createScorer({ serp: serp && withCache(serp, cache), quality, demo }), demo });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`Snap & Score API listening on port ${config.port}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `PORT ${config.port} is already in use`
      : 'Unable to start API server');
    process.exitCode = 1;
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.info('Stopping API server');
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10_000);
    timeout.unref();
    server.close((error) => {
      clearTimeout(timeout);
      process.exitCode = error ? 1 : 0;
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message : 'Unable to initialize API server');
  process.exitCode = 1;
}
