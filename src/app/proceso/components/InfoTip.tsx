"use client";

import { useState, ReactNode } from "react";

interface InfoTipProps {
  text?: ReactNode;
  scale?: number;
}

export default function InfoTip({ text, scale = 1 }: InfoTipProps) {
  const [open, setOpen] = useState<boolean>(false);

  if (!text) return <span />;

  const tip = (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 999,
          fontWeight: 950,
        }}
        title="Ver info"
      >
        ℹ️
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            right: 0,
            zIndex: 50,
            width: 260,
            padding: "10px 12px",
            borderRadius: 12,
            background: "white",
            border: "1px solid rgba(2,6,23,0.12)",
            boxShadow: "0 10px 30px rgba(2,6,23,0.10)",
            fontSize: 12,
            color: "rgba(15,23,42,0.9)",
          }}
        >
          {text}
        </div>
      )}
    </span>
  );

  if (scale === 1) return tip;

  return (
    <span
      style={{
        display: "inline-block",
        transform: `scale(${scale})`,
        transformOrigin: "center",
      }}
    >
      {tip}
    </span>
  );
}
