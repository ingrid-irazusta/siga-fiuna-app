import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  // Solo se puede ejecutar en el cliente
  if (typeof window === 'undefined') {
    throw new Error('Supabase client solo puede usarse en el navegador');
  }

  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidas en las variables de entorno'
      );
    }

    supabase = createClient(url, key);
  }

  return supabase;
};

// Exportar para lazy loading
export const initSupabase = (): void => {
  if (typeof window !== 'undefined') {
    getSupabase();
  }
};