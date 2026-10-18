import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

export interface Config {
  port: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
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

  return {
    port: Number(rawPort),
    supabaseUrl: supabaseUrl!,
    supabaseAnonKey,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
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
