"use client"; // Esto es necesario para componentes que usan hooks

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    // Excluir rutas públicas (/auth)
    if (window.location.pathname.startsWith("/auth")) {
      setAuthenticated(true);
      setLoading(false);
      return;
    }

    // Revisar sesión actual
    const session = supabase.auth.getSession();

    session.then(({ data }) => {
      if (data.session?.user) {
        setAuthenticated(true);
      } else {
        router.replace("/auth"); // Redirige a login si no hay sesión
      }
      setLoading(false);
    });

    // Escuchar cambios de sesión
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          router.replace("/auth");
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return <div>Cargando...</div>; // Puedes poner un spinner si quieres
  }

  if (!authenticated) {
    return null; // Mientras redirige, no mostrar contenido
  }

  return <>{children}</>;
}
