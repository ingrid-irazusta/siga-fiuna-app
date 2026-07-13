"use client";

import { useMemo, useState } from "react";
import ProcesoTable from "./ProcesoTable";
import {
  Row,
  ChildRow,
  normText,
  clampNum,
  cloneRowsDeep,
  calcProcessTotal,
  calcPesoTotal,
  calcCumpleMinimos,
  groupTotals,
  calcTotalConRecu,
  recuTarget,
  calcExoneracion,
  calcParcialPts,
  calcResultadoFinalFIUNA,
  createEmptyRows,
} from "@/lib/procesoUtils";

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
  mode?: "process" | "standalone";
}

function rowTotalRaw(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return (peso * pct) / 100;
}

function rowTotalOf(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return (peso * pct) / 100;
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
  mode = "standalone",
}: SimuladorNotasProps) {
  const [internalRows, setInternalRows] = useState<Row[]>(() => cloneRowsDeep(initialRows ?? createEmptyRows()));
  const [internalRecuPct, setInternalRecuPct] = useState(60);
  const [internalFinalPct, setInternalFinalPct] = useState(60);
  const [internalUseRecuForFinal, setInternalUseRecuForFinal] = useState(false);
  const [internalSemestre, setInternalSemestre] = useState<number>(semestre ?? 1);

  const rows = controlledRows ?? internalRows;
  const setRows = onRowsChange ?? setInternalRows;
  const recuPct = controlledRecuPct ?? internalRecuPct;
  const setRecuPct = onRecuPctChange ?? setInternalRecuPct;
  const finalPct = controlledFinalPct ?? internalFinalPct;
  const setFinalPct = onFinalPctChange ?? setInternalFinalPct;
  const useRecuForFinal = controlledUseRecuForFinal ?? internalUseRecuForFinal;
  const setUseRecuForFinal = onUseRecuForFinalChange ?? setInternalUseRecuForFinal;

  const [isEditing, setIsEditing] = useState(false);
  const [draftRows, setDraftRows] = useState<Row[] | null>(null);
  const calculationRows = isEditing && draftRows ? draftRows : rows;

  const simTotal = useMemo(() => calcProcessTotal(calculationRows), [calculationRows]);
  const simPesoTotal = useMemo(() => calcPesoTotal(calculationRows), [calculationRows]);
  const simPesoOk = simPesoTotal === 100;
  const simCumpleMin = useMemo(() => calcCumpleMinimos(calculationRows), [calculationRows]);
  const simValido = simPesoOk && simCumpleMin;

  const sp1 = calculationRows.find((x) => x.rid === "p1") || calculationRows.find((x) => normText(x?.label).includes("parcial 1"));
  const sp2 = calculationRows.find((x) => x.rid === "p2") || calculationRows.find((x) => normText(x?.label).includes("parcial 2"));
  const sp1pct = clampNum(sp1?.pct ?? 0, 0, 100);
  const sp2pct = clampNum(sp2?.pct ?? 0, 0, 100);

  const simRecuperatorio = simValido && (simTotal >= 30 || sp1pct >= 40 || sp2pct >= 40);
  const simHab = simValido && simTotal >= 50;

  const activeSemestre = mode === "standalone" ? internalSemestre : semestre;
  const simEx = calcExoneracion(activeSemestre, simTotal);
  const simRecuPctValue = clampNum(recuPct ?? 60, 0, 100);
  const simTarget = recuTarget(calculationRows);
  const simTotalConRecu = calcTotalConRecu(calculationRows, simRecuPctValue);
  const simExConRecu = calcExoneracion(activeSemestre, simTotalConRecu);

  const baseFinalProceso = useRecuForFinal && simRecuperatorio ? simTotalConRecu : simTotal;
  const simHabFinal = simValido && baseFinalProceso >= 50;
  const simResultadoFinal = calcResultadoFinalFIUNA(baseFinalProceso, clampNum(finalPct ?? 60, 0, 100));
  const simNotaFinal = simResultadoFinal.notaFinal;

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

  function startEditing() {
    setDraftRows(cloneRowsDeep(rows));
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftRows(null);
    setIsEditing(false);
  }

  function saveEditing() {
    if (draftRows) {
      setRows(draftRows);
    }
    setDraftRows(null);
    setIsEditing(false);
  }

  function updateDraftRow(itemId: string, rid: string, patch: Partial<Row>) {
    setDraftRows((prev) => {
      if (!prev) return prev;
      return prev.map((r) => (r.rid === rid ? { ...r, ...patch } : r));
    });
  }

  function updateDraftChild(itemId: string, groupRid: string, childRid: string, patch: Partial<ChildRow>) {
    setDraftRows((prev) => {
      if (!prev) return prev;
      return prev.map((r) => {
        if (r.rid !== groupRid) return r;
        const kids = Array.isArray(r.children) ? r.children : [];
        return {
          ...r,
          children: kids.map((c) => (c.rid === childRid ? { ...c, ...patch } : c)),
        };
      });
    });
  }

  function makeLocalId(prefix: string) {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }

  function addRow() {
    const newRow: Row = { rid: makeLocalId("r"), label: "Nueva instancia", peso: 0, min: 0, pct: 0 };
    setDraftRows((prev) => (prev ? [...prev, newRow] : [newRow]));
  }

  function addGroup() {
    const newGroup: Row = {
      rid: makeLocalId("g"), label: "Nuevo grupo", peso: 0, min: 0, pct: 0, isGroup: true,
      children: [{ rid: makeLocalId("c"), label: "Nueva subinstancia", peso: 0, pct: 0 }],
    };
    setDraftRows((prev) => (prev ? [...prev, newGroup] : [newGroup]));
  }

  function addSubRow(groupRid: string) {
    const newChild: ChildRow = { rid: makeLocalId("c"), label: "Nueva subinstancia", peso: 0, pct: 0 };
    setDraftRows((prev) => {
      if (!prev) return prev;
      return prev.map((r) => (r.rid === groupRid ? { ...r, children: [...(r.children || []), newChild] } : r));
    });
  }

  function removeRow(_itemId: string, rid: string) {
    setDraftRows((prev) => (prev ? prev.filter((r) => r.rid !== rid) : prev));
  }

  function removeSubRow(_itemId: string, groupRid: string, childRid: string) {
    setDraftRows((prev) => {
      if (!prev) return prev;
      return prev.map((r) => (r.rid !== groupRid ? r : { ...r, children: (r.children || []).filter((c) => c.rid !== childRid) }));
    });
  }

  const tableRows = isEditing && draftRows ? draftRows : rows;

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
      {mode === "standalone" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-start" }}>
          <div className="pill">
            Semestre: <select
              className="kbd"
              value={String(internalSemestre)}
              onChange={(e) => setInternalSemestre(Number(e.target.value))}
              style={{ marginLeft: 8, padding: "4px 8px", borderRadius: 8 }}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>

          {mode === "standalone" && (
            <div style={{ display: "flex", gap: 8 }}>
              {!isEditing ? (
                <button className="btn" type="button" onClick={() => startEditing()} style={{ borderRadius: 999, fontWeight: 950, fontSize: 12, padding: "6px 12px", height: 32 }}>
                  ✏️ Editar
                </button>
              ) : (
                <>
                  <button className="btn" type="button" onClick={() => saveEditing()} style={{ borderRadius: 999, fontWeight: 950, fontSize: 12, padding: "6px 12px", height: 32 }}>
                    💾 Guardar
                  </button>
                  <button className="btn" type="button" onClick={() => cancelEditing()} style={{ borderRadius: 999, fontWeight: 950, fontSize: 12, padding: "6px 12px", height: 32 }}>
                    Cancelar
                  </button>
                </>
              )}
            </div>
          )}
        </div>

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
            {mode === "standalone" ? (
              <ProcesoTable
                itemId="standalone"
                rows={tableRows}
                isEditing={isEditing}
                updateDraftRow={updateDraftRow}
                updateDraftChild={updateDraftChild}
                addRow={() => addRow()}
                addGroup={() => addGroup()}
                addSubRow={(itemId, groupRid) => addSubRow(groupRid)}
                removeRow={(itemId, rid) => removeRow(itemId, rid)}
                removeSubRow={(itemId, groupRid, childRid) => removeSubRow(itemId, groupRid, childRid)}
                pesoTotal={simPesoTotal}
                simTotal={simTotal}
              />
            ) : (
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
            )}
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
              <b>{simValido ? (simEx.ok ? `SI (nota ${simEx.nota})` : `NO (faltan ${simEx.puntosNecesarios} pts)`) : "-"}</b>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Semestre {activeSemestre}: curso {simEx.tipoCurso}, exoneración desde {simEx.umbral} puntos.
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
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Rendimiento ponderado calculado</div>
            <div style={{ fontWeight: 950, fontSize: 22 }}>{simHabFinal ? `${simResultadoFinal.ponderadoCalculado}%` : "-"}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>RP definitivo aplicado</div>
            <div style={{ fontWeight: 950, fontSize: 22 }}>{simHabFinal ? `${simResultadoFinal.rendimientoPonderado}%` : "-"}</div>
          </div>

          <div
            style={{
              border: "1px solid rgba(2,6,23,0.10)",
              borderRadius: 14,
              padding: 12,
              background: "rgba(0,176,255,0.08)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Nota final FIUNA estimada</div>
            <div style={{ fontWeight: 950, fontSize: 28 }}>{simHabFinal ? simNotaFinal : "-"}</div>
            {simHabFinal && !simResultadoFinal.cumpleMinimoFinal && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>Reprobado: el examen final es menor al 40%.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
