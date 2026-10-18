import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config/env.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export type VerifyToken = (token: string) => Promise<string | null>;

export function createUserVerifier(config: Config): VerifyToken {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
      return payload.sub || null;
    } catch {
      // Supabase validates tokens when local JWKS verification is unavailable,
      // including projects still using legacy HS256 signing keys.
      const { data, error } = await authClient.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    }
  };
}

export function requireUser(verifyToken: VerifyToken): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    const userId = await verifyToken(match[1]);
    if (!userId) {
      res.status(401).json({ error: 'invalid token' });
      return;
    }
    req.userId = userId;
    next();
  };
}
