import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import type { AnalysisOutput } from '../../shared/contracts.js';
import { createApp } from '../src/app.js';
import { AnalysisError, createGeminiAnalyzer, validateOutput } from '../src/analysis/gemini.js';
import { resolveIdentification } from '../src/analysis/identification.js';

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
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...product, ambiguous: true, candidates: [] }) }] } }] });
  } });
  assert.deepEqual(await analyze(image), resolveIdentification({ ...product, ambiguous: true, candidates: [] }));
});

test('visual model identification requires evidence and separation from alternatives', () => {
  const candidate = { model: 'WH-1000XM5', confidence: 0.95, labelVisible: false,
    evidence: ['Cylindrical hinge joint', 'Slim continuous headband'] };
  const result = resolveIdentification({ ...product, confidence: 0.95, ambiguous: false, candidates: [candidate] });
  assert.equal(result.model, 'WH-1000XM5');
  assert.equal(result.name, 'Sony WH-1000XM5');
  assert.deepEqual(Object.keys(result).sort(), Object.keys(product).sort());
  for (const extra of [
    { ambiguous: true, candidates: [candidate] },
    { ambiguous: false, candidates: [{ ...candidate, confidence: 0.7 }] },
    { ambiguous: false, candidates: [candidate, { ...candidate, model: 'WH-1000XM4', confidence: 0.9 }] },
    { ambiguous: false, candidates: [{ ...candidate, evidence: ['Sony logo'] }] },
    { ambiguous: false, candidates: [{ ...candidate, evidence: ['Sony logo', 'sony logo'] }] },
  ]) {
    const unresolved = resolveIdentification({ ...product, model: candidate.model, name: 'Sony WH-1000XM5', ...extra });
    assert.equal(unresolved.model, '');
    assert.ok(!unresolved.name.includes('XM5'));
  }
  assert.equal(resolveIdentification({ ...product, ambiguous: false,
    candidates: [{ ...candidate, labelVisible: true, evidence: ['Readable model label'] }] }).model, candidate.model);
});

test('invalid candidate evidence is rejected rather than trusted', () => {
  const empty = { category: '', brand: '', model: '', name: '', summary: '', confidence: 0 };
  assert.deepEqual(resolveIdentification({ ...empty, ambiguous: true, candidates: [] }), empty);
  for (const candidates of [null, [{ model: 'X', confidence: 2, labelVisible: false, evidence: [] }]]) {
    assert.throws(() => resolveIdentification({ ...product, ambiguous: false, candidates }), AnalysisError);
  }
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

test('diagnostics identify provider failure without leaking key or response body', async () => {
  const logs: string[] = [];
  const analyze = createGeminiAnalyzer({ apiKey: 'private-key',
    logger: { error: (message: string) => logs.push(message) },
    fetcher: async () => new Response('private-photo-and-provider-message', { status: 403 }),
  });
  await assert.rejects(analyze(image), AnalysisError);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).stage, 'provider_http');
  assert.equal(JSON.parse(logs[0]).providerStatus, 403);
  assert.doesNotMatch(logs.join(''), /private-|imageBase64/);
});

test('optional fallback resolves a label-free candidate without changing the public contract', async () => {
  const calls: string[] = [];
  const analyze = createGeminiAnalyzer({ apiKey: 'test', model: 'primary', fallbackModel: 'stronger', logger,
    fetcher: async (url) => {
      calls.push(String(url));
      const value = calls.length === 1 ? { ...product, ambiguous: true, candidates: [] }
        : { ...product, confidence: 0.95, ambiguous: false, candidates: [
          { model: 'WH-1000XM5', confidence: 0.95, labelVisible: false,
            evidence: ['Distinctive hinge', 'Distinctive headband connection'] },
        ] };
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
    },
  });
  const result = await analyze(image);
  assert.equal(result.model, 'WH-1000XM5');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('/stronger:generateContent'));
  assert.deepEqual(Object.keys(result).sort(), Object.keys(product).sort());
});

test('fallback failure or conflicting brand preserves the initial family identification', async () => {
  const family = { ...product, ambiguous: true, candidates: [] };
  for (const fails of [true, false]) {
    let calls = 0;
    const analyze = createGeminiAnalyzer({ apiKey: 'test', fallbackModel: 'stronger', logger,
      fetcher: async () => {
        calls++;
        if (calls === 2 && fails) return new Response('{}', { status: 429 });
        const value = calls === 1 ? family : { ...product, brand: 'Different brand', confidence: 0.99,
          ambiguous: false, candidates: [{ model: 'Other', confidence: 0.99, labelVisible: true, evidence: ['Label'] }] };
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
      },
    });
    assert.deepEqual(await analyze(image), resolveIdentification(family));
    assert.equal(calls, 2);
  }
});

test('fallback does not add requests for exact matches, provider errors or absent products', async () => {
  for (const kind of ['match', 'error', 'empty']) {
    let calls = 0;
    const analyze = createGeminiAnalyzer({ apiKey: 'test', fallbackModel: 'stronger', logger,
      fetcher: async () => {
        calls++;
        if (kind === 'error') return new Response('{}', { status: 400 });
        const value = kind === 'match' ? { ...product, confidence: 0.95, ambiguous: false,
          candidates: [{ model: 'WH-1000XM5', confidence: 0.95, labelVisible: true, evidence: ['Label'] }] }
          : { category: '', brand: '', model: '', name: '', summary: '', confidence: 0, ambiguous: true, candidates: [] };
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
      },
    });
    if (kind === 'error') await assert.rejects(analyze(image), AnalysisError);
    else await analyze(image);
    assert.equal(calls, 1);
  }
});
