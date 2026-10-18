import { Router } from 'express';
import { AnalysisError, validateOutput } from '../analysis/gemini.js';
import { ListingsError } from '../listings/serpapi.js';
import { requireUser, type VerifyToken } from '../middleware/requireUser.js';
import type { Demo } from '../scoring/demo.js';
import { DemoDropError, type DemoDrop } from '../scoring/demoDrop.js';
import type { ScoreProduct } from '../scoring/scoreProduct.js';

export function scoreRouter(verifyToken: VerifyToken, score?: ScoreProduct, demo?: Demo, demoDrop?: DemoDrop) {
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

  // DEMO_MODE only. With an item_id, the drop updates the checkout offer, the history, and the saved card
  // together. With brand and model it only changes scoring (terminal checks and tests).
  if (demo) {
    const fail = (error: unknown, res: import('express').Response, next: import('express').NextFunction) => {
      if (error instanceof DemoDropError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    router.post('/demo/offer', requireUser(verifyToken), async (req, res, next) => {
      try {
        const { item_id: itemId } = req.body ?? {};
        if (typeof itemId !== 'string' || !uuid.test(itemId)) { res.status(400).json({ error: 'Send a valid item_id.' }); return; }
        if (!demoDrop) throw new DemoDropError(503, 'Demo checkout is not configured.');
        res.json(await demoDrop.createOffer(req.userId!, itemId));
      } catch (error) { fail(error, res, next); }
    });
    router.post('/demo/price-drop', requireUser(verifyToken), async (req, res, next) => {
      const { brand, model, target_price: target, item_id: itemId } = req.body ?? {};
      if (itemId !== undefined) {
        try {
          if (typeof itemId !== 'string' || !uuid.test(itemId) || (target != null && !(typeof target === 'number' && target > 0))) {
            res.status(400).json({ error: 'Send a valid item_id and an optional positive target_price.' }); return;
          }
          if (!demoDrop) throw new DemoDropError(503, 'Demo checkout is not configured.');
          res.json(await demoDrop.drop(req.userId!, itemId, target ?? null));
        } catch (error) { fail(error, res, next); }
        return;
      }
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
