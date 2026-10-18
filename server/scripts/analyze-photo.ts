// Explicit operator command: sends the selected local product photo to Gemini.
import { readFile } from 'node:fs/promises';
import { config as loadDotenv } from 'dotenv';
import { defaultEnvPath } from '../src/config/env.js';
import { AnalysisError, createGeminiAnalyzer } from '../src/analysis/gemini.js';

async function main() {
  const args = process.argv.slice(2);
  const allowed = ['--image', '--model', '--fallback-model', '--expected-model'];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('usage');
    values.set(args[i], args[i + 1]);
  }
  if (!values.has('--image')) throw new Error('usage');
  loadDotenv({ path: defaultEnvPath, quiet: true });
  if (!process.env.GEMINI_API_KEY) throw new AnalysisError(503, 'GEMINI_API_KEY is required in the server environment.');
  const bytes = await readFile(values.get('--image')!);
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if ((!jpeg && !png) || bytes.length > 6 * 1024 * 1024) throw new AnalysisError(400, 'Use a JPEG or PNG product photo smaller than 6 MB.');
  const model = values.get('--model') ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
  const fallbackModel = values.get('--fallback-model') ?? process.env.GEMINI_VISION_FALLBACK_MODEL;
  const start = performance.now();
  const result = await createGeminiAnalyzer({ apiKey: process.env.GEMINI_API_KEY, model, fallbackModel })({
    imageBase64: bytes.toString('base64'), mimeType: jpeg ? 'image/jpeg' : 'image/png',
  });
  const expected = values.get('--expected-model');
  console.log(JSON.stringify({ model, fallbackModel, durationMs: Math.round(performance.now() - start), result,
    ...(expected === undefined ? {} : { expectedModel: expected, outcome: !result.model ? 'unresolved'
      : result.model.toLowerCase() === expected.toLowerCase() ? 'correct' : 'incorrect' }),
  }, null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof AnalysisError ? error.message :
    'Photo test failed. Usage: npm run analyze:photo -- --image PATH [--model MODEL] [--fallback-model MODEL] [--expected-model MODEL]');
  process.exitCode = 1;
});
