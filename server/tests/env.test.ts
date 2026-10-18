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
  assert.equal(config.checkoutWatcherEnabled, true);
  assert.equal(config.demoMode, false);
});

test('checkout configuration rejects live keys and invalid flags without exposing secrets', () => {
  for (const env of [
    { STRIPE_SECRET_KEY: 'sk_live_private' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_private' },
    { STRIPE_WEBHOOK_SECRET: 'bad_private' }, { DEMO_MODE: 'yes' }, { CHECKOUT_WATCHER_ENABLED: 'yes' },
  ]) {
    assert.throws(() => parseConfig({ ...base, ...env }), (error: unknown) =>
      error instanceof Error && !error.message.includes('private'));
  }
  assert.equal(parseConfig({ ...base, CHECKOUT_WATCHER_ENABLED: 'false' }).checkoutWatcherEnabled, false);
  assert.equal(parseConfig({ ...base, DEMO_MODE: 'true' }).demoMode, true);
  assert.equal(parseConfig({ ...base, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_existing' }).stripePublishableKey,
    'pk_test_existing');
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
