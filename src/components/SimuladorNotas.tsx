"use client";

import { useMemo, useState } from "react";

interface ChildRow {
  rid: string;
  label: string;
  peso: number;
  pct: number;
}

interface Row {
  rid: string;
  label: string;
  peso: number;
  min: number;
  pct: number;
  isGroup?: boolean;
  children?: ChildRow[];
}

interface ExoneracionResult {
  ok: boolean;
  nota: number | null;
}

interface RecuTarget {
  rid: string;
  label: string;
  pts: number;
}

interface GroupTotals {
  pesoGrupo: number;
  totalGrupo: number;
  pctGrupo: number;
}

interface SimuladorNotasProps {
  title?: string;
  initialRows?: Row[] | null;
  rows?: Row[];
  onRowsChange?: (rows: Row[]) => void;
  recuPct?: number;
  onRecuPctChange?: (value: number) => void;
  finalPct?: number;
  onFinalPctChange?: (value: number) => void;
  useRecuForFinal?: boolean;
  onUseRecuForFinalChange?: (value: boolean) => void;
  semestre?: number;
}

function normText(s: string | null | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function clampNum(v: string | number, min: number, max: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function cloneRowsDeep(rows: Row[] | null | undefined): Row[] {
  return Array.isArray(rows) ? rows.map((r) => ({ ...r, children: Array.isArray(r.children) ? r.children.map((c) => ({ ...c })) : undefined })) : [];
}

function calcRowTotal(peso: number, pct: number): number {
  const w = clampNum(peso, 0, 999);
  const p = clampNum(pct, 0, 100);
  return (w * p) / 100;
}

function rowTotalRaw(r: Row | ChildRow): number {
  const peso = clampNum(r?.peso, 0, 999);
  const pct = clampNum(r?.pct, 0, 100);
  return calcRowTotal(peso, pct);
}

function rowTotalOf(r: Row | ChildRow): number {
  const peso = clampNum(r?.peso, 0, 999);
  const pct = clampNum(r?.pct, 0, 100);
  return calcRowTotal(peso, pct);
}

function groupTotals(groupRow: Row): GroupTotals {
  const kids = Array.isArray(groupRow?.children) ? groupRow.children : [];
  const hasKids = kids.length > 0;

  const pesoGrupo = hasKids
    ? kids.reduce((acc, k) => acc + clampNum(k?.peso, 0, 999), 0)
    : clampNum(groupRow?.peso, 0, 999);

  const sumKids = kids.reduce((acc, k) => acc + rowTotalOf(k), 0);
  const totalGrupo = Math.min(sumKids, pesoGrupo);

  const pctGrupo = pesoGrupo > 0 ? Math.round((totalGrupo / pesoGrupo) * 100) : 0;

  return { pesoGrupo, totalGrupo, pctGrupo };
}

function calcCumpleMinimos(rows: Row[]): boolean {
  const arr = Array.isArray(rows) ? rows : [];

  for (const r of arr) {
    const minPct = clampNum(r?.min, 0, 100);
    if (!minPct) continue;

    const hasKids = Array.isArray(r?.children) && r.children.length > 0;
    const peso = hasKids ? groupTotals(r).pesoGrupo : clampNum(r?.peso, 0, 999);
    const minPts = Math.round((peso * minPct) / 100);
    const totalPts = hasKids ? groupTotals(r).totalGrupo : rowTotalOf(r);

    if (totalPts < minPts) return false;
  }

  return true;
}

function calcProcessTotal(rows: Row[]): number {
  const arr = Array.isArray(rows) ? rows : [];

  const sum = arr.reduce((acc, r) => {
    const hasKids = Array.isArray(r?.children) && r.children.length > 0;

    if (hasKids) {
      const kids = Array.isArray(r.children) ? r.children : [];
      return acc + kids.reduce((a, k) => a + rowTotalRaw(k), 0);
    }

    return acc + rowTotalRaw(r);
  }, 0);

  return Math.round(sum);
}

function calcPesoTotal(rows: Row[]): number {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.reduce((acc, r) => {
    const hasKids = Array.isArray(r?.children) && r.children.length > 0;
    if (hasKids) return acc + groupTotals(r).pesoGrupo;
    return acc + clampNum(r?.peso, 0, 999);
  }, 0);
}

function calcExoneracion(semestre: number, P: number): ExoneracionResult {
  const S = Number(semestre) || 0;
  const p = Number(P) || 0;

  if (S > 0 && S <= 4) {
    if (p >= 91) return { ok: true, nota: 5 };
    if (p >= 81) return { ok: true, nota: 4 };
    if (p >= 71) return { ok: true, nota: 3 };
    if (p >= 61) return { ok: true, nota: 2 };
    if (p >= 51) return { ok: true, nota: 1 };
    return { ok: false, nota: null };
  }

  if (S >= 5) {
    if (p >= 91) return { ok: true, nota: 5 };
    if (p >= 81) return { ok: true, nota: 4 };
    if (p >= 71) return { ok: true, nota: 3 };
    if (p >= 61) return { ok: true, nota: 2 };
    if (p >= 51) return { ok: true, nota: 1 };
    return { ok: false, nota: null };
  }

  return { ok: false, nota: null };
}

function calcTotalConRecu(rows: Row[], recuPct: number): number {
  const baseTotal = calcProcessTotal(rows);
  const t = recuTarget(rows);
  const parcial = rows.find((x) => x.rid === t.rid);
  const pesoParcial = clampNum(parcial?.peso ?? 0, 0, 999);
  const recuPts = Math.round((pesoParcial * clampNum(recuPct, 0, 100)) / 100);
  return Math.round(baseTotal - t.pts + recuPts);
}

function recuTarget(rows: Row[]): RecuTarget {
  const p1Pts = calcParcialPts(rows, "p1");
  const p2Pts = calcParcialPts(rows, "p2");
  if (p1Pts <= p2Pts) return { rid: "p1", label: "Parcial 1", pts: p1Pts };
  return { rid: "p2", label: "Parcial 2", pts: p2Pts };
}

function calcParcialPts(rows: Row[], rid: string): number {
  const r = rows.find((x) => x.rid === rid);
  if (!r) return 0;
  return rowTotalOf(r);
}

function calcNotaFinalFIUNA(baseFinalProceso: number, finalPct: number): number {
  const base = clampNum(baseFinalProceso, 0, 100);
  const pct = clampNum(finalPct, 0, 100);
  if (pct < 40) return 1;
  return Number(((base * 0.6) + (pct * 0.4)).toFixed(1));
}

function createEmptyRows(): Row[] {
  return [
    { rid: "p1", label: "Parcial 1", peso: 0, min: 0, pct: 0 },
    { rid: "p2", label: "Parcial 2", peso: 0, min: 0, pct: 0 },
    { rid: "final", label: "Final", peso: 0, min: 0, pct: 0 },
  ];
}

export default function SimuladorNotas({
  title = "🧪 Simulador de Notas",
  initialRows,
  rows: controlledRows,
  onRowsChange,
  recuPct: controlledRecuPct,
  onRecuPctChange,
  finalPct: controlledFinalPct,
  onFinalPctChange,
  useRecuForFinal: controlledUseRecuForFinal,
  onUseRecuForFinalChange,
  semestre = 1,
}: SimuladorNotasProps) {
  const [internalRows, setInternalRows] = useState<Row[]>(() => cloneRowsDeep(initialRows ?? createEmptyRows()));
  const [internalRecuPct, setInternalRecuPct] = useState(60);
  const [internalFinalPct, setInternalFinalPct] = useState(60);
  const [internalUseRecuForFinal, setInternalUseRecuForFinal] = useState(false);

  const rows = controlledRows ?? internalRows;
  const setRows = onRowsChange ?? setInternalRows;
  const recuPct = controlledRecuPct ?? internalRecuPct;
  const setRecuPct = onRecuPctChange ?? setInternalRecuPct;
  const finalPct = controlledFinalPct ?? internalFinalPct;
  const setFinalPct = onFinalPctChange ?? setInternalFinalPct;
  const useRecuForFinal = controlledUseRecuForFinal ?? internalUseRecuForFinal;
  const setUseRecuForFinal = onUseRecuForFinalChange ?? setInternalUseRecuForFinal;

  const simTotal = useMemo(() => calcProcessTotal(rows), [rows]);
  const simPesoTotal = useMemo(() => calcPesoTotal(rows), [rows]);
  const simPesoOk = simPesoTotal === 100;
  const simCumpleMin = useMemo(() => calcCumpleMinimos(rows), [rows]);
  const simValido = simPesoOk && simCumpleMin;

  const sp1 = rows.find((x) => x.rid === "p1") || rows.find((x) => normText(x?.label).includes("parcial 1"));
  const sp2 = rows.find((x) => x.rid === "p2") || rows.find((x) => normText(x?.label).includes("parcial 2"));
  const sp1pct = clampNum(sp1?.pct ?? 0, 0, 100);
  const sp2pct = clampNum(sp2?.pct ?? 0, 0, 100);

  const simRecuperatorio = simValido && (simTotal >= 30 || sp1pct >= 40 || sp2pct >= 40);
  const simHab = simValido && simTotal >= 50;

  const simEx = simValido ? calcExoneracion(semestre, simTotal) : { ok: false, nota: null };
  const simRecuPctValue = clampNum(recuPct ?? 60, 0, 100);
  const simTarget = recuTarget(rows);
  const simTotalConRecu = calcTotalConRecu(rows, simRecuPctValue);
  const simExConRecu = simValido ? calcExoneracion(semestre, simTotalConRecu) : { ok: false, nota: null };

  const baseFinalProceso = useRecuForFinal && simRecuperatorio ? simTotalConRecu : simTotal;
  const simHabFinal = simValido && baseFinalProceso >= 50;
  const simNotaFinal = simHabFinal ? calcNotaFinalFIUNA(baseFinalProceso, clampNum(finalPct ?? 60, 0, 100)) : 1;

  const sectionTitle = (txt: string) => (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--primary2)",
        border: "1px solid rgba(2,6,23,0.10)",
        borderRadius: 14,
        fontWeight: 950,
        color: "var(--primary)",
      }}
    >
      {txt}
    </div>
  );

  return (
    <div
      style={{
        background: "var(--bg)",
        borderRadius: 16,
        padding: 12,
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid rgba(2,6,23,0.10)",
          borderRadius: 16,
          padding: 12,
          boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {rows.length ? "Calculadora temporal" : "Inicio vacío"}
        </div>
      </div>

      <div
        className="simTwoCols"
        style={{
          display: "grid",
          gap: 12,
          alignItems: "start",
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 12,
            boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
            display: "grid",
            gap: 10,
          }}
        >
          {sectionTitle("📋 Proceso editable (solo simulador)")}

          {!simPesoOk && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                background: "rgba(220,38,38,0.10)",
                border: "1px solid rgba(220,38,38,0.18)",
                color: "rgba(220,38,38,0.95)",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              ⚠️ La suma de PESO debe ser 100. Ahora es: {simPesoTotal}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: "70%" }} />
                <col style={{ width: "30%" }} />
              </colgroup>

              <thead>
                <tr style={{ fontSize: 12, color: "var(--muted)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>INSTANCIA</th>
                  <th style={{ textAlign: "center", padding: "6px 8px" }}>% HECHO</th>
                </tr>
              </thead>

              <tbody>
                {rows.flatMap((r) => {
                  const isGroup = !!r.isGroup;
                  const hasKids = Array.isArray(r.children) && r.children.length > 0;
                  const g = hasKids ? groupTotals(r) : null;

                  const mainRow = (
                    <tr key={r.rid} style={{ borderTop: "1px solid rgba(2,6,23,0.08)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 900 }}>{String(r?.label ?? "")}</td>

                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <input
                          className="input numMini"
                          type="number"
                          min={0}
                          max={100}
                          value={String(isGroup && hasKids ? g!.pctGrupo : r?.pct ?? 0)}
                          disabled={isGroup && hasKids}
                          onChange={(e) => {
                            const v = clampNum(e.target.value, 0, 100);
                            setRows(
                              rows.map((x) => (x.rid === r.rid ? { ...x, pct: v } : x))
                            );
                          }}
                          style={{
                            width: 90,
                            textAlign: "center",
                            fontWeight: 900,
                            opacity: isGroup && hasKids ? 0.65 : 1,
                            cursor: isGroup && hasKids ? "not-allowed" : "text",
                          }}
                        />
                      </td>
                    </tr>
                  );

                  if (!isGroup) return [mainRow];

                  const kids = Array.isArray(r.children) ? r.children : [];
                  const kidsRows = kids.map((k) => (
                    <tr
                      key={`${r.rid}__${k.rid}`}
                      style={{
                        borderTop: "1px solid rgba(2,6,23,0.06)",
                        background: "rgba(2,6,23,0.03)",
                      }}
                    >
                      <td style={{ padding: "6px 8px", fontSize: 12 }}>
                        <span style={{ opacity: 0.65, marginRight: 6 }}>↳</span>
                        <span style={{ fontWeight: 800 }}>{String(k?.label ?? "")}</span>
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <input
                          className="input numMini"
                          type="number"
                          min={0}
                          max={100}
                          value={String(k?.pct ?? 0)}
                          onChange={(e) => {
                            const v = clampNum(e.target.value, 0, 100);
                            setRows(
                              rows.map((x) =>
                                x.rid !== r.rid
                                  ? x
                                  : {
                                      ...x,
                                      children: kids.map((z) =>
                                        z.rid === k.rid ? { ...z, pct: v } : z
                                      ),
                                    }
                              )
                            );
                          }}
                          style={{
                            width: 90,
                            textAlign: "center",
                            fontWeight: 900,
                          }}
                        />
                      </td>
                    </tr>
                  ));

                  return [mainRow, ...kidsRows];
                })}

                <tr style={{ borderTop: "1px solid rgba(2,6,23,0.12)" }}>
                  <td style={{ padding: "8px", fontWeight: 950 }}>TOTAL PROCESO (simulado)</td>
                  <td style={{ padding: "8px", textAlign: "center", fontWeight: 950 }}>
                    {simTotal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div
          style={{
            background: "var(--card)",
            border: "1px solid rgba(2,6,23,0.10)",
            borderRadius: 16,
            padding: 12,
            boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
            display: "grid",
            gap: 10,
          }}
        >
          {sectionTitle("💡 Recomendación rápida")}

          {!simValido ? (
            <div style={{ fontSize: 13, color: "var(--text)" }}>
              Primero cumplí <b>mínimos</b> y el <b>peso total</b>. Sin eso no conviene planificar recu/final/exoneración.
            </div>
          ) : simEx.ok ? (
            <div style={{ fontSize: 13, color: "var(--text)" }}>
              Ya exonerás. Normalmente conviene <b>no arriesgar</b> y conservar.
            </div>
          ) : simHab ? (
            <div style={{ fontSize: 13, color: "var(--text)" }}>
              Tenés firma. Podés estimar el <b>final</b> y ver si te conviene.
            </div>
          ) : simRecuperatorio ? (
            <div style={{ fontSize: 13, color: "var(--text)" }}>
              Estás habilitada para <b>recuperatorio</b>. Probá escenarios y mirá si llegás a exonerar.
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text)" }}>
              Aún no habilita recu ni firma. Necesitás subir tu proceso.
            </div>
          )}

          <div
            style={{
              marginTop: 8,
              borderTop: "1px solid rgba(2,6,23,0.08)",
              paddingTop: 10,
              display: "grid",
              gap: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Mínimos</span>
              <b>{simPesoOk ? (simCumpleMin ? "SI" : "NO") : "-"}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Recuperatorio</span>
              <b>{simValido ? (simRecuperatorio ? "SI" : "NO") : "-"}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Firma</span>
              <b>{simValido ? (simHab ? "SI" : "NO") : "-"}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Exoneración</span>
              <b>{simValido ? (simEx.ok ? `SI (nota ${simEx.nota})` : "NO") : "-"}</b>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid rgba(2,6,23,0.10)",
          borderRadius: 16,
          padding: 12,
          boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
          display: "grid",
          gap: 10,
        }}
      >
        {sectionTitle("🧪 Escenario con recuperatorio")}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>% recu esperado</span>

          <input
            className="input numMini"
            type="number"
            min={0}
            max={100}
            value={String(simRecuPctValue)}
            disabled={!(simValido && simRecuperatorio)}
            onChange={(e) => setRecuPct(clampNum(e.target.value, 0, 100))}
            style={{ width: 90, textAlign: "center", fontWeight: 950 }}
          />

          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Reemplaza: <b>{simTarget.label}</b>
          </span>

          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 900,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(2,6,23,0.10)",
              background: simValido && simRecuperatorio ? "rgba(78,228,108,0.12)" : "rgba(2,6,23,0.06)",
              color: "var(--text)",
            }}
          >
            {simValido ? (simRecuperatorio ? "Habilitado" : "No habilitado") : "No aplica"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div
            style={{
              background: "var(--card)",
              border: "1px solid rgba(2,6,23,0.10)",
              borderRadius: 14,
              padding: 12,
              boxShadow: "0 8px 22px rgba(2,6,23,0.06)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Total simulado con recu</div>
            <div style={{ fontWeight: 950, fontSize: 28, lineHeight: 1.1 }}>
              {simValido && simRecuperatorio ? simTotalConRecu : "-"}
            </div>
          </div>

          <div
            style={{
              background: "var(--card)",
              border: "1px solid rgba(2,6,23,0.10)",
              borderRadius: 14,
              padding: 12,
              boxShadow: "0 8px 22px rgba(2,6,23,0.06)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Exoneración posible en 2º final</div>
            <div style={{ fontWeight: 950, fontSize: 16 }}>
              {simValido && simRecuperatorio ? (simExConRecu.ok ? `SI (nota ${simExConRecu.nota})` : "NO") : "-"}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              (Reemplaza el parcial de menor rendimiento)
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid rgba(2,6,23,0.10)",
          borderRadius: 16,
          padding: 12,
          boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
          display: "grid",
          gap: 10,
        }}
      >
        {sectionTitle("🎓 Escenario con final")}

        <div style={{ fontSize: 13, color: "var(--text)" }}>
          Ingresá cuánto creés que vas a sacar en el final y te estima la <b>nota (1–5)</b>. (Regla: si el final es menor a 40 puntos ⇒ 1 directo.)
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Puntaje de final esperado</span>

          <input
            className="input numMini"
            type="number"
            min={0}
            max={100}
            value={String(clampNum(finalPct ?? 60, 0, 100))}
            onChange={(e) => setFinalPct(clampNum(e.target.value, 0, 100))}
            style={{ width: 90, textAlign: "center", fontWeight: 950 }}
            disabled={!simHabFinal}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={useRecuForFinal}
              onChange={(e) => setUseRecuForFinal(e.target.checked)}
              disabled={!(simValido && simRecuperatorio)}
            />
            Usar "Total con recu" si aplica
          </label>

          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 900,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(2,6,23,0.10)",
              background: simHabFinal ? "rgba(78,228,108,0.12)" : "rgba(2,6,23,0.06)",
              color: "var(--text)",
            }}
          >
            {simHabFinal ? "Con firma" : "Sin firma"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div
            style={{
              border: "1px solid rgba(2,6,23,0.10)",
              borderRadius: 14,
              padding: 12,
              background: "rgba(2,6,23,0.02)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Proceso usado para el cálculo</div>
            <div style={{ fontWeight: 950, fontSize: 22 }}>{simHabFinal ? baseFinalProceso : "-"}</div>
          </div>

          <div
            style={{
              border: "1px solid rgba(2,6,23,0.10)",
              borderRadius: 14,
              padding: 12,
              background: "rgba(0,176,255,0.08)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Nota final estimada</div>
            <div style={{ fontWeight: 950, fontSize: 28 }}>{simHabFinal ? simNotaFinal : "-"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
