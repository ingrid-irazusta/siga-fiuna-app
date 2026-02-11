"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

    try {
      // Verificar si hay token de autenticación en localStorage
      const token = localStorage.getItem("auth_token");
      const currentUser = localStorage.getItem("current_user");

      if (token && currentUser) {
        setAuthenticated(true);
        setLoading(false);
      } else {
        // Redirigir a login si no hay sesión
        router.replace("/auth");
        setLoading(false);
      }
    } catch (error) {
      console.error("Error checking auth:", error);
      router.replace("/auth");
      setLoading(false);
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

