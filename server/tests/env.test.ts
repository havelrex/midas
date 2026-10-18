import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { defaultEnvPath, loadConfig, parseConfig } from '../src/config/env.js';
import { createSupabaseAdmin } from '../src/lib/supabaseAdmin.js';

const base = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_ANON_KEY: 'test-anon-key' };

test('defaults work without feature keys or a service-role key', () => {
  const config = parseConfig(base);
  assert.equal(config.port, 4000);
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.supabaseServiceRoleKey, undefined);
  assert.throws(() => createSupabaseAdmin(config), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('invalid configuration reports variable names without leaking values', () => {
  for (const PORT of ['0', '65536', '1.5', 'NaN', '', '-1']) {
    assert.throws(() => parseConfig({ ...base, PORT }), /PORT/);
  }
  assert.throws(() => parseConfig({ ...base, SUPABASE_ANON_KEY: '' }), /SUPABASE_ANON_KEY/);
  assert.throws(() => parseConfig({ ...base, SUPABASE_URL: 'secret-invalid-url' }),
    { message: 'SUPABASE_URL must be a valid HTTP(S) origin' });
});

test('root env path is independent of the working directory', () => {
  assert.equal(defaultEnvPath, resolve(fileURLToPath(new URL('../../.env', import.meta.url))));
});

test('env file fills missing variables but exported variables win', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'snapscore-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, '.env');
  writeFileSync(file, 'PORT=4001\nSUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=file-key\n');
  const env = { PORT: '5000' };
  assert.equal(loadConfig(env, file).port, 5000);
  assert.equal(loadConfig(env, file).supabaseAnonKey, 'file-key');
  assert.equal(loadConfig({ ...base }, join(dir, 'missing')).port, 4000);
});
