import express, { Router } from 'express';
import { errorHandler, type Logger } from './middleware/errorHandler.js';
import type { VerifyToken } from './middleware/requireUser.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { analyzeRouter } from './routes/analyze.js';
import type { AnalyzeImage } from './analysis/gemini.js';
import type { CheckoutService } from './checkout/service.js';
import { checkoutRouter, stripeWebhookRouter } from './routes/checkout.js';
import { scoreRouter } from './routes/score.js';
import type { Demo } from './scoring/demo.js';
import type { ScoreProduct } from './scoring/scoreProduct.js';

export function createApp(options: { verifyToken: VerifyToken; logger?: Logger; analyze?: AnalyzeImage; checkout?: CheckoutService;
  score?: ScoreProduct; demo?: Demo }) {
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

  app.use(stripeWebhookRouter(options.checkout));
  const api = Router();
  api.use(express.json({ limit: '10mb' }));
  api.use(meRouter(options.verifyToken));
  api.use(analyzeRouter(options.verifyToken, options.analyze));
  api.use(checkoutRouter(options.verifyToken, options.checkout));
  api.use(scoreRouter(options.verifyToken, options.score, options.demo));
  app.use(api);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(logger));
  return app;
}
