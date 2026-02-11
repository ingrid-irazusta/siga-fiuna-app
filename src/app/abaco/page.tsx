"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* =========================================================
   TIPOS
========================================================= */

type CalcResult = {
  empty?: boolean;
  rp?: number | null;
  nota?: number | null;
  blocked?: boolean;
};

/* =========================================================
   LÓGICA
========================================================= */

function calcNota(P: string | number, F: string | number): CalcResult {
  if (P === "" || P === null || typeof P === "undefined") return { empty: true };

  const p = Number(P);
  const f = Number(F);

  if (!Number.isFinite(p) || p < 50) return { rp: null, nota: null, blocked: true };
  if (!Number.isFinite(f) || f < 40) return { rp: null, nota: 1 };

  const rp = Math.round(Math.max(0.3 * f + 0.7 * p, f));

  let nota = 1;
  if (rp >= 91) nota = 5;
  else if (rp >= 81) nota = 4;
  else if (rp >= 71) nota = 3;
  else if (rp >= 60) nota = 2;
  else nota = 1;

  return { rp, nota };
}

function cellClass(nota?: number | null) {
  if (nota === 5) return "cell5";
  if (nota === 4) return "cell4";
  if (nota === 3) return "cell3";
  if (nota === 2) return "cell2";
  return "cell1";
}

const PROCESO: number[] = [
  50,
  59,
  ...Array.from({ length: 99 - 59 }, (_, i) => 60 + i),
  100,
];

const FINAL: (number | string)[] = [
  100,
  ...Array.from({ length: 91 - 40 + 1 }, (_, i) => 91 - i),
  ">40",
];

const exoBasicos = (p: number) =>
  p >= 91 ? 5 : p >= 81 ? 4 : p >= 71 ? 3 : "";

const exoProfesionales = (p: number) =>
  p >= 91 ? 5 : p >= 81 ? 4 : "";

/* =========================================================
   PAGE
========================================================= */

export default function Page() {
  const [P, setP] = useState<string>("70");
  const [F, setF] = useState<string>("55");

  const res = useMemo(() => calcNota(P, F), [P, F]);

  const mainOuterRef = useRef<HTMLDivElement | null>(null);
  const mainTableRef = useRef<HTMLTableElement | null>(null);
  const exoOuterRef = useRef<HTMLDivElement | null>(null);
  const exoTableRef = useRef<HTMLTableElement | null>(null);

  const [autoScaleMain, setAutoScaleMain] = useState<number>(1);
  const [autoScaleExo, setAutoScaleExo] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);

  const recomputeScale = () => {
    const clampFit = (
      outer: HTMLDivElement | null,
      table: HTMLTableElement | null
    ) => {
      if (!outer || !table) return 1;
      const containerW = outer.clientWidth;
      const tableW = table.scrollWidth;
      if (!containerW || !tableW) return 1;
      return Math.min(1, containerW / tableW);
    };

    setAutoScaleMain(clampFit(mainOuterRef.current, mainTableRef.current));
    setAutoScaleExo(clampFit(exoOuterRef.current, exoTableRef.current));
  };

  useEffect(() => {
    recomputeScale();
    const ro = new ResizeObserver(() => recomputeScale());
    if (mainOuterRef.current) ro.observe(mainOuterRef.current);
    if (exoOuterRef.current) ro.observe(exoOuterRef.current);
    return () => ro.disconnect();
  }, []);

  const effectiveScaleMain = Math.max(0.5, Math.min(1.25, autoScaleMain * zoom));
  const effectiveScaleExo = Math.max(0.5, Math.min(1.25, autoScaleExo * zoom));

  const zoomIn = () =>
    setZoom((z) => Math.min(1.25, Math.round((z + 0.05) * 100) / 100));

  const zoomOut = () =>
    setZoom((z) => Math.max(0.5, Math.round((z - 0.05) * 100) / 100));

  const zoomReset = () => setZoom(1);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="card">
        <div className="cardPad">
          <div className="calcBar">
            <div className="calcField">
              <label className="muted" style={{ fontSize: 12 }}>
                P (Proceso)
              </label>
              <input
                className="select"
                value={P}
                onChange={(e) => setP(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <div className="calcField">
              <label className="muted" style={{ fontSize: 12 }}>
                F (Final)
              </label>
              <input
                className="select"
                value={F}
                onChange={(e) => setF(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <div className="calcResult">
              <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
                Nota final
              </div>
              <div
                className={`bigNota ${
                  res?.empty ? "" : cellClass(res?.nota)
                }`}
                style={{
                  padding: "8px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(15,23,42,0.10)",
                }}
              >
                {res?.empty ? "—" : res?.blocked ? "—" : res?.nota}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="abacoTitle">ÁBACO</div>

        <div className="abacoToolbar">
          <div className="abacoZoomGroup">
            <button className="abacoBtn" onClick={zoomOut}>−</button>
            <button className="abacoBtn" onClick={zoomIn}>+</button>
            <button className="abacoBtn" onClick={zoomReset}>Reset</button>
            <span className="abacoBadge">
              Zoom: {Math.round(effectiveScaleMain * 100)}%
            </span>
          </div>

          <a
            href="https://drive.google.com/uc?export=download&id=1TSK5XoiwnWpFXyIDsG08fLbGyQpX67wH"
            target="_blank"
            rel="noreferrer"
            className="abacoBtn"
            style={{ textDecoration: "none" }}
          >
            Descargar Ábaco (HD)
          </a>
        </div>

        <div className="abacoFitOuter" ref={mainOuterRef}>
          <div
            className="abacoFitInner"
            style={{ transform: `scale(${effectiveScaleMain})` }}
          >
            <table className="abacoTable" ref={mainTableRef}>
              <thead>
                <tr>
                  <th className="leftSticky">Pts</th>
                  {PROCESO.map((p) => (
                    <th key={p}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FINAL.map((f) => (
                  <tr key={String(f)}>
                    <td className="leftSticky">{f}</td>
                    {PROCESO.map((p) => {
                      if (f === ">40") {
                        return (
                          <td key={`${f}-${p}`} className={cellClass(1)}>
                            1
                          </td>
                        );
                      }
                      const r = calcNota(p, f as number);
                      const nota = r.empty || r.blocked ? "" : r.nota;
                      return (
                        <td
                          key={`${f}-${p}`}
                          className={cellClass(nota as number)}
                        >
                          {nota}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
