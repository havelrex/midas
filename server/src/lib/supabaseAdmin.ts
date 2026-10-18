import { createClient } from '@supabase/supabase-js';
import { ConfigurationError, type Config } from '../config/env.js';

// Call once when wiring future automation. This privileged client bypasses RLS;
// ordinary authentication uses an anon-key client instead.
export function createSupabaseAdmin(config: Config) {
  if (!config.supabaseServiceRoleKey) {
    throw new ConfigurationError('SUPABASE_SERVICE_ROLE_KEY is required for admin operations');
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
