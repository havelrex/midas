import { Router } from 'express';
import { requireUser, type VerifyToken } from '../middleware/requireUser.js';

export function meRouter(verifyToken: VerifyToken) {
  const router = Router();
  router.get('/me', requireUser(verifyToken), (req, res) => {
    res.json({ userId: req.userId });
  });
  return router;
}
