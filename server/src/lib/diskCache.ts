import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface DiskCache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

// src/lib and dist/lib sit at the same depth relative to server/data.
export const defaultCacheDir = fileURLToPath(new URL('../../data/cache/', import.meta.url));

// Survives restarts, so a scored item reads the same on every scan until its entry expires.
// Cache problems (missing, corrupt, unwritable) are never fatal: they just count as a miss.
export function createDiskCache(options: { ttlMs: number; dir?: string; now?: () => number }): DiskCache {
  const dir = options.dir ?? defaultCacheDir;
  const now = options.now ?? Date.now;
  const file = (key: string) => `${dir}${createHash('sha256').update(key).digest('hex')}.json`;
  return {
    get<T>(key: string): T | undefined {
      try {
        const entry = JSON.parse(readFileSync(file(key), 'utf8'));
        if (typeof entry?.savedAt !== 'number' || now() - entry.savedAt > options.ttlMs) return undefined;
        return entry.value as T;
      } catch { return undefined; }
    },
    set(key, value) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file(key), JSON.stringify({ savedAt: now(), key, value }));
      } catch { /* a failed write only means the next scan is not cached */ }
    },
  };
}
