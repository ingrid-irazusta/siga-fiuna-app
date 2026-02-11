"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, ReactNode } from "react";
import { createPortal } from "react-dom";

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

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [profileInfo, setProfileInfo] = useState<{ carrera: string; malla: string }>({ carrera: "", malla: "" });

  const pageLabel = getPageLabel(pathname);
  const headerTop = pathname === "/" ? APP_TITLE : pageLabel;

  const headerInfo = useMemo((): string => {
    const pieces: string[] = [APP_VERSION];
    if (profileInfo.carrera) pieces.push(profileInfo.carrera);
    if (profileInfo.malla) pieces.push(`Malla ${profileInfo.malla}`);
    if (pieces.length === 1) pieces.push("Información importante");
    return pieces.join(" — ");
  }, [profileInfo]);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    setMounted(true);
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const narrow = window.innerWidth <= 980;
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
          <div className="appBrand">SIGA FIUNA</div>
          <button type="button" className="appCloseBtn" onClick={() => setNavOpen(false)} aria-label="Cerrar menú">✕</button>
        </div>

        <nav className="appNav">
          {navItems.map((it) => {
            const active = it.href === "/" ? pathname === "/" : pathname?.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} className={`appNavItem ${active ? "active" : ""}`} onClick={() => setNavOpen(false)}>
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );

  return (
    <div className={`appShellRoot ${isMobile ? "isMobileDevice" : ""}`}>
      <header className="appTopbar">
        <button
          type="button"
          className="appHamb"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Menú"
        >
          ☰
        </button>
        <div className="appBrand">SIGA FIUNA</div>
      </header>

      {mounted ? createPortal(drawerUI, document.body) : null}

      <main className="main">
        <div className="mainInner">
          <div className="dashHeader">
            <div className="dashHeaderTop">{headerTop}</div>
          </div>
          {children}
        </div>
      </main>

      <style jsx>{`
        .appShellRoot{
          min-height: 100vh;
          background: var(--bg);
          display: block;
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
