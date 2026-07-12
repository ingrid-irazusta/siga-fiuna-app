"use client";

import React from "react";
import {
  Row,
  ChildRow,
  clampNum,
  groupTotals,
  rowTotalOf,
} from "@/lib/procesoUtils";

interface ProcesoTableProps {
  itemId: string;
  rows: Row[];
  isEditing: boolean;
  updateDraftRow: (itemId: string, rid: string, patch: Partial<Row>) => void;
  updateDraftChild: (itemId: string, groupRid: string, childRid: string, patch: Partial<ChildRow>) => void;
  addGroup?: (itemId: string) => void;
  addSubRow?: (itemId: string, groupRid: string) => void;
  removeRow?: (itemId: string, rid: string) => void;
  removeSubRow?: (itemId: string, groupRid: string, childRid: string) => void;
  pesoTotal?: number;
  simTotal?: number;
}

export default function ProcesoTable({ itemId, rows, isEditing, updateDraftRow, updateDraftChild, addGroup, addSubRow, removeRow, removeSubRow, pesoTotal, simTotal }: ProcesoTableProps) {
  return (
    <div
      className="procTableWrap procEvalWrap"
      style={{ padding: 8, overflowX: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x", flex: 1 }}
    >
      <div style={{ minWidth: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 60 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 40 }} />
            <col style={{ width: 40 }} />
          </colgroup>

          <thead>
            <tr style={{ fontSize: 12, color: "var(--muted)" }}>
              <th style={{ padding: "4px 6px", whiteSpace: "nowrap", textAlign: "left" }}>INSTANCIA</th>
              <th style={{ padding: "4px 6px", whiteSpace: "nowrap", textAlign: "center" }}>PESO</th>
              <th style={{ padding: "4px 6px", whiteSpace: "nowrap", textAlign: "center" }}>MIN REQ.</th>
              <th style={{ padding: "4px 6px", whiteSpace: "nowrap", textAlign: "center" }}>%HECHO</th>
              <th style={{ padding: "4px 6px", whiteSpace: "nowrap", textAlign: "center" }}>TOTAL</th>
              <th style={{ padding: "4px 6px", textAlign: "center" }} />
            </tr>
          </thead>

          <tbody>
            {rows.flatMap((r) => {
              const isP = r.rid === "p1" || r.rid === "p2";
              const isGroup = !!r.isGroup;

              const hasKids = Array.isArray(r.children) && r.children.length > 0;
              const g = hasKids ? groupTotals(r) : null;
              const totalRow = isGroup && hasKids ? g!.totalGrupo : rowTotalOf(r);

              const groupRow = (
                <tr key={r.rid} style={{ borderTop: "1px solid rgba(2,6,23,0.08)", background: "transparent" }}>
                  <td style={{ padding: "4px 6px", textAlign: "left" }}>
                    {isP || !isEditing ? (
                      <div style={{ fontWeight: 900, padding: "4px 6px" }}>{String(r?.label ?? "")}</div>
                    ) : (
                      <input
                        className="input numMini"
                        value={String(r?.label ?? "")}
                        onChange={(e) => updateDraftRow(itemId, r.rid, { label: e.target.value })}
                        style={{ width: "100%", padding: "4px 6px", fontWeight: 900 }}
                      />
                    )}
                  </td>

                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <input
                      className="input numMini"
                      type="number"
                      min={0}
                      max={999}
                      value={String(isGroup && hasKids ? g!.pesoGrupo : r?.peso ?? 0)}
                      disabled={!isEditing || (isGroup && hasKids)}
                      onChange={(e) => {
                        if (!isEditing || (isGroup && hasKids)) return;
                        updateDraftRow(itemId, r.rid, { peso: clampNum(e.target.value, 0, 999) });
                      }}
                      style={{ width: 72, minWidth: 72, maxWidth: 72, padding: "4px 6px", fontWeight: 800, textAlign: "center", opacity: isGroup && hasKids ? 0.7 : 1, cursor: isGroup && hasKids ? "not-allowed" : "text" }}
                    />
                  </td>

                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    {isP ? (
                      <span style={{ opacity: 0.6 }}> </span>
                    ) : (
                      <input
                        className="input numMini"
                        type="number"
                        min={0}
                        max={999}
                        value={String((r as any)?.min ?? 0)}
                        disabled={!isEditing}
                        onChange={(e) => updateDraftRow(itemId, r.rid, { min: clampNum(e.target.value, 0, 999) })}
                        style={{ width: 72, minWidth: 72, maxWidth: 72, padding: "4px 6px", fontWeight: 800, textAlign: "center" }}
                      />
                    )}
                  </td>

                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <input
                      className="input numMini"
                      type="number"
                      min={0}
                      max={100}
                      value={String(isGroup && hasKids ? g!.pctGrupo : (r?.pct ?? 0))}
                      disabled={!isEditing || (isGroup && hasKids)}
                      onChange={(e) => {
                        if (!isEditing || (isGroup && hasKids)) return;
                        updateDraftRow(itemId, r.rid, { pct: clampNum(e.target.value, 0, 100) });
                      }}
                      style={{ width: 56, minWidth: 56, maxWidth: 56, padding: "4px 6px", fontWeight: 800, textAlign: "center", opacity: isGroup && hasKids ? 0.7 : 1 }}
                    />
                  </td>

                  <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 800 }}>{totalRow}</td>

                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    {!isEditing ? (
                      <span />
                    ) : isP ? (
                      <span />
                    ) : isGroup ? (
                      hasKids ? (
                        <button
                          className="btn"
                          onClick={() => addSubRow && addSubRow(itemId, r.rid)}
                          style={{ width: 34, height: 34, padding: 0, borderRadius: 999 }}
                          title="Agregar subfila"
                        >
                          +
                        </button>
                      ) : (
                        <button
                          className="btn"
                          onClick={() => removeRow && removeRow(itemId, r.rid)}
                          style={{ width: 34, height: 34, padding: 0, borderRadius: 999 }}
                          title="Eliminar grupo"
                        >
                          ✕
                        </button>
                      )
                    ) : (
                      <button
                        className="btn"
                        onClick={() => removeRow && removeRow(itemId, r.rid)}
                        style={{ width: 34, height: 34, padding: 0, borderRadius: 999 }}
                        title="Eliminar fila"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );

              if (!isGroup) return [groupRow];

              const kids = Array.isArray(r.children) ? r.children : [];
              const kidsRows = kids.map((k) => (
                <tr key={`${r.rid}__${k.rid}`} style={{ borderTop: "1px solid rgba(2,6,23,0.06)", background: "rgba(2,6,23,0.03)" }}>
                  <td style={{ padding: "6px 8px", fontSize: 12 }}>
                    <span style={{ opacity: 0.65, marginRight: 6 }}>↳</span>
                    <span style={{ fontWeight: 800 }}>{String(k?.label ?? "")}</span>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <input
                      className="input numMini"
                      type="number"
                      min={0}
                      max={999}
                      value={String(k?.peso ?? 0)}
                      disabled={!isEditing}
                      onChange={(e) => updateDraftChild(itemId, r.rid, k.rid, { peso: clampNum(e.target.value, 0, 999) })}
                      style={{ width: 72, minWidth: 72, maxWidth: 72, padding: "4px 6px", fontWeight: 800, textAlign: "center" }}
                    />
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <span className="muted" style={{ fontSize: 12 }}></span>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <input
                      className="input numMini"
                      type="number"
                      min={0}
                      max={100}
                      value={String(k?.pct ?? 0)}
                      disabled={!isEditing}
                      onChange={(e) => updateDraftChild(itemId, r.rid, k.rid, { pct: clampNum(e.target.value, 0, 100) })}
                      style={{ width: 56, minWidth: 56, maxWidth: 56, padding: "4px 6px", fontWeight: 800, textAlign: "center" }}
                    />
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: 800 }}>{Math.round((k.peso * (k.pct || 0)) / 100)}</td>
                  <td>
                    {isEditing ? (
                      <button
                        className="btn"
                        onClick={() => removeSubRow && removeSubRow(itemId, r.rid, k.rid)}
                        style={{ width: 34, height: 34, padding: 0, borderRadius: 999 }}
                        title="Eliminar subfila"
                      >
                        ✕
                      </button>
                    ) : (
                      <span />
                    )}
                  </td>
                </tr>
              ));

              return [groupRow, ...kidsRows];
            })}

            <tr style={{ borderTop: "1px solid rgba(2,6,23,0.12)" }}>
              <td style={{ padding: "8px", fontWeight: 950 }}>TOTAL PROCESO</td>
              <td style={{ padding: "8px", textAlign: "center", fontWeight: 950 }}>{typeof pesoTotal === "number" ? pesoTotal : ""}</td>
              <td />
              <td />
              <td style={{ padding: "8px", textAlign: "center", fontWeight: 950 }}>{typeof simTotal === "number" ? simTotal : ""}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
