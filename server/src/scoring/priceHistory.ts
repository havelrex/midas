import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PricePoint } from './timing.js';
import { alnum } from './util.js';

// src/scoring and dist/scoring sit at the same depth relative to server/data.
export const defaultHistoryDir = fileURLToPath(new URL('../../data/price-history/', import.meta.url));
// Demo price drops are written here (gitignored, emptied by `npm run cache:clear`), never into the seed files.
export const defaultOverlayDir = fileURLToPath(new URL('../../data/cache/price-history/', import.meta.url));

// Punctuation-proof, so "WH-1000XM5" and "WH1000XM5" share one file: sony-wh1000xm5.json.
const slug = (brand: string, model: string) => (alnum(brand) && alnum(model) ? `${alnum(brand)}-${alnum(model)}` : '');

function readHistory(dir: string, name: string): PricePoint[] {
  try {
    const file = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8'));
    return Array.isArray(file.history) ? file.history : [];
  } catch { return []; }
}

// With the default directory, the seed is merged with demo overlay entries (the newer entry wins per date).
// A custom directory is read on its own, which is how tests and scripts isolate themselves.
export function loadPriceHistory(brand: string, model: string, dir = defaultHistoryDir,
  overlayDir: string | undefined = dir === defaultHistoryDir ? defaultOverlayDir : undefined): PricePoint[] {
  const name = slug(brand, model);
  if (!name) return [];
  const seed = readHistory(dir, name);
  if (!overlayDir) return seed;
  const byDate = new Map(seed.map((p) => [p.date, p]));
  for (const p of readHistory(overlayDir, name)) byDate.set(p.date, p);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Demo price drop: today's price becomes the newest history entry (replacing any entry for that date).
export function appendHistory(brand: string, model: string, point: PricePoint, dir = defaultOverlayDir): void {
  const name = slug(brand, model);
  if (!name) throw new Error('brand and model are required');
  const history = readHistory(dir, name).filter((p) => p.date !== point.date);
  history.push(point);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${name}.json`, JSON.stringify({ brand, model, history }, null, 2) + '\n');
}
