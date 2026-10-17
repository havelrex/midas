import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS. Server-only (automation, purchase updates).
// Never ship this key to the mobile app.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
