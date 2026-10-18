import { createApp } from './app.js';
import { createGeminiAnalyzer } from './analysis/gemini.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { createUserVerifier } from './middleware/requireUser.js';
import { createCheckout } from './checkout/createCheckout.js';
import { startCheckoutWatcher } from './checkout/watcher.js';

try {
  const config = loadConfig();
  const checkout = createCheckout(config);
  if (!checkout) console.info('Sandbox checkout is disabled: payment configuration is incomplete.');
  const app = createApp({ verifyToken: createUserVerifier(config),
    checkout,
    analyze: createGeminiAnalyzer({ apiKey: config.geminiApiKey, model: config.geminiModel }) });
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
