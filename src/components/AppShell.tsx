"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, ReactNode } from "react";
import { createPortal } from "react-dom";
import { MaintenanceProvider, useMaintenanceMode } from "@/components/MaintenanceProvider";

const APP_TITLE = "SISTEMA INTELIGENTE DE GESTIÓN ACADÉMICA FIUNA";
const APP_VERSION = "v18";

const PROFILE_KEY = "fiuna_os_profile_v1";

interface Profile {
  carrera?: string;
  malla?: string;
}

function safeLoadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

const navItems: { href: string; label: string }[] = [
  { href: "/", label: "Inicio" },
  { href: "/calendario-academico", label: "Calendario Académico" },
  { href: "/horario", label: "Horario de Clases" },
  { href: "/proceso", label: "Proceso de Evaluación" },
  { href: "/simulador", label: "Simulador de Notas" },
  { href: "/evaluaciones", label: "Horario de Exámenes" },
  { href: "/malla", label: "Malla Curricular" },
  { href: "/notas-finales", label: "Notas Finales" },
  { href: "/abaco", label: "Ábaco" }
];

function getPageLabel(pathname: string | null): string {
  if (!pathname || pathname === "/") return "Inicio";
  const found = navItems.find((it) => pathname.startsWith(it.href) && it.href !== "/");
  return found?.label || "";
}

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell(props: AppShellProps) {
  return (
    <MaintenanceProvider>
      <AppShellContent {...props} />
    </MaintenanceProvider>
  );
}

function AppShellContent({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const maintenance = useMaintenanceMode();
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(false);
  const [profileInfo, setProfileInfo] = useState<{ carrera: string; malla: string }>({ carrera: "", malla: "" });

  const handleLogout = async () => {
    try {
      const { getSupabase } = await import("../lib/supabaseClient");
      const supabase = getSupabase();
      await supabase.auth.signOut();
      router.push("/auth");
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      router.push("/auth");
    }
  };

  const handleToggleTheme = () => {
    const newDarkMode = !isDark;
    setIsDark(newDarkMode);
    localStorage.setItem("fiuna_theme_mode", newDarkMode ? "dark" : "light");
    if (newDarkMode) {
      document.documentElement.classList.add("dark-mode");
    } else {
      document.documentElement.classList.remove("dark-mode");
    }
  };

  const pageLabel = getPageLabel(pathname);
  const headerTop = pathname === "/" ? APP_TITLE : pageLabel;

  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    setMounted(true);
    // Cargar tema desde localStorage
    try {
      const savedTheme = localStorage.getItem("fiuna_theme_mode");
      const dark = savedTheme === "dark";
      setIsDark(dark);
      // Aplicar clase al documento
      if (dark) {
        document.documentElement.classList.add("dark-mode");
      } else {
        document.documentElement.classList.remove("dark-mode");
      }
    } catch {}
    
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const narrow = window.innerWidth <= 768;
      const ua = navigator.userAgent || '';
      const mobileUA = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
      const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      setIsMobile(Boolean(coarse || narrow || mobileUA || touchCapable));
    } catch {}

    try {
      const p = safeLoadProfile();
      const carrera = String(p?.carrera || "").trim();
      const malla = String(p?.malla || "").trim();
      setProfileInfo({ carrera, malla });
    } catch {}

    const onProfileUpdated = () => {
      try {
        const p = safeLoadProfile();
        const carrera = String(p?.carrera || "").trim();
        const malla = String(p?.malla || "").trim();
        setProfileInfo({ carrera, malla });
      } catch {}
    };
    window.addEventListener('fiuna_profile_updated', onProfileUpdated);
    return () => window.removeEventListener('fiuna_profile_updated', onProfileUpdated);
  }, []);

  const drawerUI = (
    <>
      {navOpen && <div className="appOverlay" onClick={() => setNavOpen(false)} />}
      <aside className={`appSidebar ${navOpen ? "open" : ""}`} aria-label="Menú lateral">
        <div className="appSideHeader">
          <div className="appBrand">MENU</div>
          <button type="button" className="appCloseBtn" onClick={() => setNavOpen(false)} aria-label="Cerrar menú">✕</button>
        </div>

        <nav className="appNav">
          {navItems.map((it) => {
            const active = it.href === "/" ? pathname === "/" : pathname?.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} prefetch={false} className={`appNavItem ${active ? "active" : ""}`} onClick={() => setNavOpen(false)}>
                {it.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebarFooter">
          <span>Built by Ingrid Irazusta</span>
          <span>v1.0 · © 2026</span>
        </div>
      </aside>
    </>
  );

  const isAuthPage = pathname?.startsWith("/auth");

  return (
    <div className={`appShellRoot ${isMobile ? "isMobileDevice" : ""}`} style={{ minHeight: '100vh', margin: 0 }}>
      {/* Header solo si NO es login */}
      {!isAuthPage && (
        <header className="appTopbar">
          <div className="appTopbarLeft">
            <button type="button" className="appHamb" onClick={() => setNavOpen((v) => !v)} aria-label="Menú">☰</button>
            <div className="appBrand">S.I.G.A</div>
          </div>
          <div className="appTopbarRight">
            <button type="button" className="appThemeBtn" onClick={handleToggleTheme} aria-label="Cambiar tema">
              {isDark ? "☀️" : "🌙"}
            </button>
            <button type="button" className="appLogoutBtn" onClick={handleLogout} aria-label="Cerrar sesión">Cerrar sesión</button>
          </div>
        </header>
      )}

      {/* Sidebar solo si NO es login */}
      {!isAuthPage && mounted ? createPortal(drawerUI, document.body) : null}

      <main
        className="main"
        style={{
          padding: isAuthPage ? 0 : undefined,
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="mainInner" style={{ width: '100%', maxWidth: '100%', margin: 0, flex: 1 }}>
          {!isAuthPage && (
            <div className="dashHeader">
              <div className="dashHeaderTop">{headerTop}</div>
            </div>
          )}
          {!isAuthPage && maintenance.isEnabled && maintenance.sessionResolved && (
            maintenance.isBypassUser ? (
              <div
                style={{
                  width: "fit-content",
                  margin: "0 0 12px",
                  padding: "6px 10px",
                  border: "1px solid rgba(180, 83, 9, 0.24)",
                  borderRadius: 999,
                  background: "rgba(251, 191, 36, 0.10)",
                  color: "#92400e",
                  fontSize: 12,
                  fontWeight: 850,
                }}
              >
                Modo mantenimiento — acceso de prueba
              </div>
            ) : (
              <div
                role="status"
                style={{
                  margin: "0 0 12px",
                  padding: "12px 14px",
                  border: "1px solid rgba(14, 116, 144, 0.20)",
                  borderRadius: 14,
                  background: "rgba(14, 165, 233, 0.08)",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontWeight: 900 }}>SIGA está recibiendo una actualización.</div>
                <div style={{ marginTop: 3, color: "var(--muted)", fontSize: 13 }}>
                  Algunas funciones de edición están temporalmente deshabilitadas. Puedes seguir consultando tu horario, procesos, evaluaciones y notas.
                </div>
              </div>
            )
          )}
          {children}
        </div>
      </main>

      <style jsx>{`
        .appShellRoot{
          background: var(--bg);
        }
        .main{ padding: 14px; padding-top: 68px; width: 100%; }
        .mainInner{ width: 100%; max-width: 100%; margin: 0; }
        @media (max-width: 520px){
          .main{ padding: 12px; padding-top: 66px; }
          .mainInner{ max-width: 100%; }
        }
      `}</style>
    </div>
  );
}
