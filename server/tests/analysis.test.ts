import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import type { AnalysisOutput } from '../../shared/contracts.js';
import { createApp } from '../src/app.js';
import { AnalysisError, createGeminiAnalyzer, validateOutput } from '../src/analysis/gemini.js';

const product: AnalysisOutput = { category: 'Headphones', brand: 'Sony', model: '', name: 'Sony headphones', summary: 'Over-ear headphones', confidence: 0.6 };
const image = { mimeType: 'image/jpeg' as const, imageBase64: Buffer.from([255, 216, 255, 0]).toString('base64') };
const logger = { info() {}, error() {} };

test('analysis requires auth and validates image before calling provider', async () => {
  let calls = 0;
  const app = createApp({ logger, verifyToken: async () => 'user', analyze: async () => { calls++; return product; } });
  await request(app).post('/analyze').send(image).expect(401);
  await request(app).post('/analyze').set('Authorization', 'Bearer test').send({ ...image, mimeType: 'text/plain' }).expect(415);
  await request(app).post('/analyze').set('Authorization', 'Bearer test').send({ ...image, imageBase64: 'not an image' }).expect(400);
  await request(app).post('/analyze').set('Authorization', 'Bearer test').send({ ...image, imageBase64: 'YWJjZA==' }).expect(400);
  assert.equal(calls, 0);
  await request(app).post('/analyze').set('Authorization', 'Bearer test').send(image).expect(200, product);
  assert.equal(calls, 1);
});

test('output validation preserves shared contract and rejects invalid model/confidence', () => {
  const output: AnalysisOutput = validateOutput(product);
  assert.deepEqual(output, product);
  for (const value of [{ ...product, model: null }, { ...product, confidence: 2 }, { ...product, confidence: NaN }, {}]) {
    assert.throws(() => validateOutput(value), AnalysisError);
  }
});

test('Gemini request uses server header, inline image and JSON schema', async () => {
  const analyze = createGeminiAnalyzer({ apiKey: 'test-secret', fetcher: async (url, init) => {
    assert.ok(!String(url).includes('test-secret'));
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'test-secret');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.contents[0].parts[1].inlineData.data, image.imageBase64);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(product) }] } }] });
  } });
  assert.deepEqual(await analyze(image), product);
});

test('missing key, quota, timeout and malformed provider output return safe errors', async () => {
  await assert.rejects(createGeminiAnalyzer({})(image), (e: unknown) => e instanceof AnalysisError && e.status === 503);
  for (const [fetcher, status] of [
    [async () => new Response('secret-provider-error', { status: 429 }), 429],
    [async () => { throw new DOMException('secret', 'TimeoutError'); }, 504],
    [async () => Response.json({ candidates: [] }), 502],
    [async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bad json' }] } }] }), 502],
  ] as const) {
    await assert.rejects(createGeminiAnalyzer({ apiKey: 'test', fetcher })(image), (e: unknown) =>
      e instanceof AnalysisError && e.status === status && !e.message.includes('secret'));
  }
});
