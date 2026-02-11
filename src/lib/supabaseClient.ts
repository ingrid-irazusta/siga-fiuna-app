// lib/supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient;

export const getSupabase = () => {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Supabase URL o Anon Key no están definidas');
    }

    supabase = createClient(url, key);
  }
  return supabase;
};
