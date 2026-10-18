import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createUserVerifier } from '../src/middleware/requireUser.js';

test('verifier checks signed JWTs and supports Supabase legacy-token validation', async (t) => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
  let remoteValidations = 0;
  const provider = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (req.url === '/auth/v1/user') {
      remoteValidations++;
      assert.equal(req.headers.apikey, 'test-anon-key');
      if (req.headers.authorization === 'Bearer legacy-test-token') {
        res.end(JSON.stringify({ id: 'legacy-user' }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ message: 'Invalid token' }));
      }
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    provider.close((error) => error ? reject(error) : resolve());
    provider.closeAllConnections();
  }));
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const supabaseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const issuer = `${supabaseUrl}/auth/v1`;
  const verify = createUserVerifier({ port: 4000, supabaseUrl, supabaseAnonKey: 'test-anon-key' });
  const sign = (options: { issuer?: string; audience?: string; expiration?: string | number } = {}) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject('signed-user').setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? 'authenticated')
      .setExpirationTime(options.expiration ?? '5m').sign(privateKey);

  assert.equal(await verify(await sign()), 'signed-user');
  assert.equal(remoteValidations, 0, 'valid JWTs do not require an auth user request');
  for (const token of [
    await sign({ issuer: 'https://wrong-project.example/auth/v1' }),
    await sign({ audience: 'wrong-audience' }),
    await sign({ expiration: 1 }),
    'malformed-token',
  ]) {
    assert.equal(await verify(token), null);
  }
  assert.equal(await verify('legacy-test-token'), 'legacy-user');
  assert.equal(remoteValidations, 5);
});
