import type { DiskCache } from '../lib/diskCache.js';
import type { ScoringConfig } from './config.js';
import { scoreQuality } from './quality.js';
import { extractQualitySignals, type GenerateJson, type ReviewData } from './qualityExtract.js';
import type { SubScore } from './types.js';
import { productKey as key } from './util.js';


// Caches by brand + model so the stage item never changes score between runs.
export function createQualityService(options: { generate?: GenerateJson; cfg: ScoringConfig['quality']; cache?: DiskCache }) {
  const cache = new Map<string, Promise<SubScore | null>>();
  return {
    assess(product: { brand: string; model: string; name: string }, data: ReviewData): Promise<SubScore | null> {
      if (!options.generate) return Promise.resolve(null);
      const k = key(product.brand, product.model);
      const hit = k !== '|' ? cache.get(k) : undefined;
      if (hit) return hit;
      const stored = k !== '|' ? options.cache?.get<SubScore>(`quality:${k}`) : undefined;
      if (stored) return Promise.resolve(stored);
      const run = (async () => {
        const signals = await extractQualitySignals(options.generate!, product.name, data, options.cfg);
        const result = signals ? scoreQuality(signals, options.cfg) : null;
        if (result && k !== '|') options.cache?.set(`quality:${k}`, result);
        return result;
      })();
      // Failures are not cached, so a later scan can retry.
      if (k !== '|') {
        cache.set(k, run);
        void run.then((r) => { if (r === null) cache.delete(k); });
      }
      return run;
    },
  };
}
