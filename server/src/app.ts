import express, { Router } from 'express';
import { errorHandler, type Logger } from './middleware/errorHandler.js';
import type { VerifyToken } from './middleware/requireUser.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { analyzeRouter } from './routes/analyze.js';
import type { AnalyzeImage } from './analysis/gemini.js';

export function createApp(options: { verifyToken: VerifyToken; logger?: Logger; analyze?: AnalyzeImage }) {
  const app = express();
  const logger = options.logger ?? console;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = performance.now();
    // Omit query strings, headers, and bodies, which may contain credentials.
    const path = req.path;
    res.on('finish', () => logger.info(JSON.stringify({
      method: req.method, path, status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    })));
    next();
  });
  app.use(healthRouter());

  // Register future Stripe raw-body webhook routes ABOVE this JSON router.
  const api = Router();
  api.use(express.json({ limit: '10mb' }));
  api.use(meRouter(options.verifyToken));
  api.use(analyzeRouter(options.verifyToken, options.analyze));
  // Mount future analysis, listings, scoring, and checkout routers here.
  app.use(api);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(logger));
  return app;
}
