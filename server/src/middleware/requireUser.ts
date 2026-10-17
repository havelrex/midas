import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { supabaseAdmin } from '../lib/supabaseAdmin';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!.replace(/\/+$/, '');
const jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

async function userIdFromToken(token: string): Promise<string | null> {
  try {
    // Fast path: verify locally against the project's asymmetric signing keys.
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
    return payload.sub ?? null;
  } catch {
    // Fallback for projects still on the legacy shared-secret (HS256) keys.
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    return error ? null : data.user.id;
  }
}

// Attaches req.userId from the Supabase access token, or responds 401.
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  const userId = await userIdFromToken(token);
  if (!userId) {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  req.userId = userId;
  next();
}
