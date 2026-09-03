import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const environment = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const supabaseUrl = environment?.VITE_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey = environment?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const CAPACITY_EVENT_ID = 'cyber-octubre-2026';

let client: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
