import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PricePoint } from './timing.js';
import { alnum } from './util.js';

// src/scoring and dist/scoring sit at the same depth relative to server/data.
export const defaultHistoryDir = fileURLToPath(new URL('../../data/price-history/', import.meta.url));

// Punctuation-proof, so "WH-1000XM5" and "WH1000XM5" share one file: sony-wh1000xm5.json.
const slug = (brand: string, model: string) => (alnum(brand) && alnum(model) ? `${alnum(brand)}-${alnum(model)}` : '');

export function loadPriceHistory(brand: string, model: string, dir = defaultHistoryDir): PricePoint[] {
  const name = slug(brand, model);
  if (!name) return [];
  try {
    const file = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8'));
    return Array.isArray(file.history) ? file.history : [];
  } catch { return []; }
}

// Demo price drop: today's price becomes the newest history entry (replacing any entry for that date).
export function appendHistory(brand: string, model: string, point: PricePoint, dir = defaultHistoryDir): void {
  const name = slug(brand, model);
  if (!name) throw new Error('brand and model are required');
  const history = loadPriceHistory(brand, model, dir).filter((p) => p.date !== point.date);
  history.push(point);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${name}.json`, JSON.stringify({ brand, model, history }, null, 2) + '\n');
}
