import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

export interface Config {
  port: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  stripeSecretKey?: string;
  stripePublishableKey?: string;
  stripeWebhookSecret?: string;
  checkoutWatcherEnabled: boolean;
  demoMode: boolean;
}

export class ConfigurationError extends Error {}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const rawPort = env.PORT ?? '4000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new ConfigurationError('PORT must be an integer between 1 and 65535');
  }

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  try {
    const url = new URL(supabaseUrl ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch {
    throw new ConfigurationError('SUPABASE_URL must be a valid HTTP(S) origin');
  }

  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseAnonKey) throw new ConfigurationError('SUPABASE_ANON_KEY is required');

  const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim() || undefined;
  // The publishable key is intentionally public; reuse the team's existing Expo
  // setting when a separate server-side spelling isn't provided.
  const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY?.trim()
    || env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || undefined;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  if (stripeSecretKey && !stripeSecretKey.startsWith('sk_test_')) {
    throw new ConfigurationError('STRIPE_SECRET_KEY must be a sandbox sk_test_ key');
  }
  if (stripePublishableKey && !stripePublishableKey.startsWith('pk_test_')) {
    throw new ConfigurationError('STRIPE_PUBLISHABLE_KEY must be a sandbox pk_test_ key');
  }
  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
    throw new ConfigurationError('STRIPE_WEBHOOK_SECRET must be a whsec_ signing secret');
  }
  const boolean = (name: string, fallback: boolean) => {
    if (env[name] === undefined || env[name] === '') return fallback;
    if (!['true', 'false'].includes(env[name]!)) throw new ConfigurationError(`${name} must be true or false`);
    return env[name] === 'true';
  };

  return {
    port: Number(rawPort),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    supabaseUrl: supabaseUrl!,
    supabaseAnonKey,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    stripeSecretKey, stripePublishableKey, stripeWebhookSecret,
    checkoutWatcherEnabled: boolean('CHECKOUT_WATCHER_ENABLED', true),
    demoMode: boolean('DEMO_MODE', false),
  };
}

// src/config and dist/config have the same depth relative to the root .env.
export const defaultEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

export function loadConfig(env = process.env, envPath = defaultEnvPath): Config {
  const result = loadDotenv({ path: envPath, processEnv: env, override: false, quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new ConfigurationError('Unable to read the root .env file');
  }
  return parseConfig(env);
}
