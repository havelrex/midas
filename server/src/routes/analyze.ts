import { Router } from 'express';
import { AnalysisError, validateOutput, type AnalyzeImage, type ProductImage } from '../analysis/gemini.js';
import { loadScoringConfig } from '../scoring/config.js';
import { normalizeFeatured } from '../scoring/demo.js';
import { requireUser, type VerifyToken } from '../middleware/requireUser.js';

export function analyzeRouter(verifyToken: VerifyToken, analyze?: AnalyzeImage) {
  const router = Router();
  router.post('/analyze', requireUser(verifyToken), async (req, res, next) => {
    try {
      const { imageBase64, mimeType } = req.body ?? {};
      if (!['image/jpeg', 'image/png'].includes(mimeType)) {
        res.status(415).json({ error: 'Send a JPEG or PNG photo.' }); return;
      }
      if (typeof imageBase64 !== 'string' || !imageBase64.length || imageBase64.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
        res.status(400).json({ error: 'Send a valid base64 image without a data URL prefix.' }); return;
      }
      const bytes = Buffer.from(imageBase64, 'base64');
      if (bytes.length > 6 * 1024 * 1024) {
        res.status(413).json({ error: 'Photo must be smaller than 6 MB.' }); return;
      }
      const valid = mimeType === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (!valid || bytes.toString('base64') !== imageBase64) {
        res.status(400).json({ error: 'Image content does not match its format.' }); return;
      }
      if (!analyze) throw new AnalysisError(503, 'Product identification is not configured.');
      res.json(normalizeFeatured(loadScoringConfig('electronics').demo, validateOutput(await analyze({ imageBase64, mimeType } as ProductImage))));
    } catch (error) {
      if (error instanceof AnalysisError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  });
  return router;
}
