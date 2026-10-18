import { Router } from 'express';
import { AnalysisError, validateOutput } from '../analysis/gemini.js';
import { ListingsError } from '../listings/serpapi.js';
import { requireUser, type VerifyToken } from '../middleware/requireUser.js';
import type { Demo } from '../scoring/demo.js';
import type { ScoreProduct } from '../scoring/scoreProduct.js';

export function scoreRouter(verifyToken: VerifyToken, score?: ScoreProduct, demo?: Demo) {
  const router = Router();
  router.post('/score', requireUser(verifyToken), async (req, res, next) => {
    try {
      const analysis = validateOutput(req.body);
      if (!score) throw new ListingsError(503, 'Scoring is not configured.');
      res.json((await score(analysis)).output);
    } catch (error) {
      if (error instanceof AnalysisError || error instanceof ListingsError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  });

  // DEMO_MODE only: lowers the sandbox merchant's price below the target and every real store.
  if (demo) {
    router.post('/demo/price-drop', requireUser(verifyToken), (req, res) => {
      const { brand, model, target_price: target } = req.body ?? {};
      if (typeof brand !== 'string' || typeof model !== 'string' || !brand || !model ||
          (target != null && !(typeof target === 'number' && target > 0))) {
        res.status(400).json({ error: 'Send brand, model, and an optional positive target_price.' }); return;
      }
      const price = demo.triggerPriceDrop({ brand, model }, target ?? null);
      if (price == null) { res.status(409).json({ error: 'Score this item before triggering a price drop.' }); return; }
      res.json({ price });
    });
  }
  return router;
}
