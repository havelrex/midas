import { createApp } from './app.js';
import { createGeminiAnalyzer } from './analysis/gemini.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { createUserVerifier } from './middleware/requireUser.js';

try {
  const config = loadConfig();
  const app = createApp({ verifyToken: createUserVerifier(config),
    analyze: createGeminiAnalyzer({ apiKey: config.geminiApiKey, model: config.geminiModel }) });
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
