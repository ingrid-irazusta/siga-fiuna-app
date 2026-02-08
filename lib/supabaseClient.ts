// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

// Las variables vienen del .env.local
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
