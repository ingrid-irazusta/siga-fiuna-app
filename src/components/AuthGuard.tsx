"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabaseClient";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    // Excluir rutas públicas (/auth)
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/auth")) {
      setAuthenticated(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = getSupabase();

      // Usar onAuthStateChange para verificar sesión real de Supabase
      const { data: authListener } = supabase.auth.onAuthStateChange(
        (event, session) => {
          if (session?.user) {
            // Usuario autenticado
            setAuthenticated(true);
            setLoading(false);
          } else {
            // Sin sesión activa - redirigir a login
            setAuthenticated(false);
            setLoading(false);
            router.replace("/auth");
          }
        }
      );

      // Cleanup del listener cuando el componente se desmonta
      return () => {
        authListener?.subscription?.unsubscribe();
      };
    } catch (error) {
      console.error("Error checking auth:", error);
      setLoading(false);
      router.replace("/auth");
    }
  }, [router]);

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!authenticated) {
    return null;
  }

  return <>{children}</>;
}

