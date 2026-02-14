"use client";

import { useEffect, ReactNode, MouseEvent } from "react";

interface BigModalProps {
  open: boolean;
  title: string;
  onClose?: () => void;
  children: ReactNode;
}

export default function BigModal({
  open,
  title,
  onClose,
  children,
}: BigModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        padding: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(80% 60% at 50% 40%, rgba(255,255,255,0.12), rgba(2,6,23,0.65))",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "92vh",
          overflow: "hidden",
          background: "white",
          borderRadius: 18,
          border: "1px solid rgba(2,6,23,0.12)",
          boxShadow: "0 30px 80px rgba(2,6,23,0.35)",
          transform: "translateY(30px)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(2,6,23,0.10)",
            background: "var(--primary)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontWeight: 950, lineHeight: 1.1 }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>
              Esc para cerrar • Click afuera para cerrar
            </div>
          </div>

          <button
            className="btn"
            onClick={() => onClose?.()}
            style={{
              borderRadius: 999,
              width: 36,
              height: 36,
              padding: 0,
              fontWeight: 950,
              background: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(2,6,23,0.12)",
              color: "rgba(2,6,23,0.85)",
            }}
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            maxHeight: "calc(92vh - 56px)",
            overflow: "auto",
            padding: 14,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
