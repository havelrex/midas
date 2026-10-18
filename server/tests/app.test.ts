import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

function setup(verifyToken = async (token: string): Promise<string | null> =>
  token === 'valid-test-token' ? 'test-user-id' : null) {
  const logs: string[] = [];
  const app = createApp({ verifyToken, logger: {
    info: (message: string) => logs.push(message),
    error: (message: string) => logs.push(message),
  } });
  return { app, logs };
}

test('health is public and independent of authentication providers', async () => {
  const { app } = setup(async () => { throw new Error('must not be called'); });
  await request(app).get('/health').expect(200, { status: 'ok' });
});

test('me rejects missing, malformed, and invalid credentials', async () => {
  const { app } = setup();
  await request(app).get('/me').expect(401, { error: 'missing bearer token' });
  await request(app).get('/me').set('Authorization', 'Basic credentials').expect(401);
  await request(app).get('/me').set('Authorization', 'Bearer invalid').expect(401, { error: 'invalid token' });
});

test('me returns only the verified user id', async () => {
  const { app } = setup();
  await request(app).get('/me?userId=someone-else')
    .set('Authorization', 'bearer valid-test-token')
    .expect(200, { userId: 'test-user-id' });
});

test('unknown routes return JSON', async () => {
  const { app } = setup();
  await request(app).get('/not-a-route').expect('Content-Type', /json/)
    .expect(404, { error: 'not found' });
});

test('JSON parser rejects malformed and oversized payloads', async () => {
  const { app } = setup();
  await request(app).post('/not-a-route').set('Content-Type', 'application/json')
    .send('{').expect(400, { error: 'invalid JSON body' });
  await request(app).post('/not-a-route').send({ photo: 'x'.repeat(10 * 1024 * 1024) })
    .expect(413, { error: 'request body too large' });
});

test('async errors stay private and the server continues serving requests', async () => {
  const { app, logs } = setup(async () => { throw new Error('secret-provider-key'); });
  await request(app).get('/me?token=secret-query').set('Authorization', 'Bearer secret-token')
    .expect(500, { error: 'internal server error' });
  await request(app).get('/health').expect(200);
  assert.ok(logs.some((line) => line.includes('Unhandled request error')));
  assert.ok(logs.some((line) => line.includes('"status":500')));
  assert.doesNotMatch(logs.join('\n'), /secret-/);
});
