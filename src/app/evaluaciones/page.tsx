"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "../../components/Card";
import { getSupabase } from "../../lib/supabaseClient";
import { Session } from "@supabase/supabase-js";

const CURRENT_COURSES_KEY = "fiuna_os_current_courses_v1";
const EVAL_KEY = "fiuna_os_evaluaciones_v1";
const EVAL_EDITOR_OPEN_KEY = "fiuna_os_evaluaciones_editor_open_v1";

interface EvalType {
  key: string;
  label: string;
}

const TYPES: EvalType[] = [
  { key: "p1", label: "1er Parcial" },
  { key: "p2", label: "2do Parcial" },
  { key: "f1", label: "Final 1" },
  { key: "f2", label: "Final 2" },
  { key: "f3", label: "Final 3" },
];

interface EvalCell {
  fecha: string;
  hora: string;
}

interface Row {
  materia: string;
  p1: EvalCell;
  p2: EvalCell;
  f1: EvalCell;
  f2: EvalCell;
  f3: EvalCell;
}

interface Course {
  semestre?: string;
  sem?: string;
  nombre?: string;
  mat?: string;
  firma?: string;
}

interface ExamItem {
  materia: string;
  fecha: string;
  hora: string;
  dt: Date;
  dias: number | null;
  estado: string;
}

interface ExamList {
  [key: string]: ExamItem[];
}

interface SectionData {
  key: string;
  title: string;
  items: ExamItem[];
}

function safeParse(raw: string | null): unknown {
  try {
    return JSON.parse(raw || "");
  } catch {
    return null;
  }
}

function todayYMD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateTime(dateYMD: string, timeHM?: string): Date | null {
  if (!dateYMD) return null;
  const t = (timeHM || "00:00").trim();
  const iso = `${dateYMD}T${t}:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDMY(dateYMD: string): string {
  if (!dateYMD) return "";
  const [y, m, d] = dateYMD.split("-");
  if (!y || !m || !d) return dateYMD;
  return `${d}/${m}/${y}`;
}

function capFirst(s: string | null | undefined): string {
  const str = String(s || "");
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatLongES(dateYMD: string): string {
  if (!dateYMD) return "";
  const dt = parseDateTime(dateYMD, "00:00");
  if (!dt) return dateYMD;

  const weekday = dt.toLocaleDateString("es-ES", { weekday: "long" });
  const day = dt.getDate();
  const month = dt.toLocaleDateString("es-ES", { month: "long" });
  const year = dt.getFullYear();

  return `${capFirst(weekday)} ${day} de ${month} del ${year}`;
}

function daysDiffFromToday(dt: Date): number {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function buildFromInicioCourses(): Row[] {
  const raw = localStorage.getItem(CURRENT_COURSES_KEY);
  const arr = safeParse(raw) as Course[] | null;
  const list = Array.isArray(arr) ? arr : [];
  return list
    .map((x) => String(x?.nombre || x?.mat || "").trim())
    .filter(Boolean)
    .map((materia) => ({
      materia,
      p1: { fecha: "", hora: "" },
      p2: { fecha: "", hora: "" },
      f1: { fecha: "", hora: "" },
      f2: { fecha: "", hora: "" },
      f3: { fecha: "", hora: "" },
    }));
}

export default function EvaluacionesPage(): React.ReactNode {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [userId, setUserId] = useState<string>("");

  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);

  const [openMateria, setOpenMateria] = useState<string | null>(null);
  const [showFinal3, setShowFinal3] = useState<{ [key: string]: boolean }>({});
  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [pdfBusy, setPdfBusy] = useState<boolean>(false);

  const [clientNow, setClientNow] = useState<Date | null>(null);

  useEffect(() => {
    setClientNow(new Date());
  }, []);

  // Autenticación
  useEffect(() => {
    const loadSession = async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/auth");
        return;
      }
      setSession(data.session);
      setUserId(data.session.user.id);
    };
    loadSession();

    const { data: authListener } = getSupabase().auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          router.push("/auth");
        }
        setSession(session);
        setUserId(session?.user.id || "");
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  // Cargar exámenes desde Supabase
  useEffect(() => {
    if (!userId) return;

    const loadExams = async () => {
      try {
        const supabase = getSupabase();
        
        // Cargar cursos desde student_courses
        const { data: coursesData } = await supabase
          .from("student_courses")
          .select("id, materia")
          .eq("user_id", userId);
        
        const courses = coursesData ? coursesData.map(c => c.materia) : [];
        
        // Cargar exámenes desde student_exams
        const { data: exams } = await supabase
          .from("student_exams")
          .select("materia, tipo, fecha, hora")
          .eq("user_id", userId);

        // Crear filas para todas las materias en curso
        const rowMap = new Map<string, Row>();
        for (const materia of courses) {
          rowMap.set(materia, {
            materia,
            p1: { fecha: "", hora: "" },
            p2: { fecha: "", hora: "" },
            f1: { fecha: "", hora: "" },
            f2: { fecha: "", hora: "" },
            f3: { fecha: "", hora: "" },
          });
        }

        // Rellenar con exámenes existentes
        if (exams && exams.length > 0) {
          for (const exam of exams) {
            const materia = exam.materia;
            if (!rowMap.has(materia)) {
              // Si hay examen para materia no en cursos, agregarla
              rowMap.set(materia, {
                materia,
                p1: { fecha: "", hora: "" },
                p2: { fecha: "", hora: "" },
                f1: { fecha: "", hora: "" },
                f2: { fecha: "", hora: "" },
                f3: { fecha: "", hora: "" },
              });
            }
            const row = rowMap.get(materia)!;
            const typeKey = TYPES.find(t => t.label === exam.tipo)?.key;
            if (typeKey) {
              (row as any)[typeKey] = { fecha: exam.fecha, hora: exam.hora };
            }
          }
        }

        setRows(Array.from(rowMap.values()));
      } catch (error) {
        console.error("Error loading exams:", error);
        // Fallback vacío si hay error
        setRows([]);
      } finally {
        setLoaded(true);
      }
    };

    loadExams();
  }, [userId]);

  // Suscripción en tiempo real
  useEffect(() => {
    if (!userId) return;

    const supabase = getSupabase();
    const subscription = supabase
      .channel(`student_exams_${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_exams",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          console.log("Real-time exam update:", payload);
          // Recargar exámenes
          const loadExams = async () => {
            try {
              const { data: exams } = await supabase
                .from("student_exams")
                .select("materia, tipo, fecha, hora")
                .eq("user_id", userId);

              if (exams && exams.length > 0) {
                const rowMap = new Map<string, Row>();
                for (const exam of exams) {
                  const materia = exam.materia;
                  if (!rowMap.has(materia)) {
                    rowMap.set(materia, {
                      materia,
                      p1: { fecha: "", hora: "" },
                      p2: { fecha: "", hora: "" },
                      f1: { fecha: "", hora: "" },
                      f2: { fecha: "", hora: "" },
                      f3: { fecha: "", hora: "" },
                    });
                  }
                  const row = rowMap.get(materia)!;
                  const typeKey = TYPES.find(t => t.label === exam.tipo)?.key;
                  if (typeKey) {
                    (row as any)[typeKey] = { fecha: exam.fecha, hora: exam.hora };
                  }
                }
                setRows(Array.from(rowMap.values()));
              }
            } catch (error) {
              console.error("Error reloading exams:", error);
            }
          };
          loadExams();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;

    const syncFromInicio = (): void => {
      const fromInicio = buildFromInicioCourses();
      setRows((prev) => {
        if (Array.isArray(prev) && prev.length > 0 && fromInicio.length === 0) return prev;
        const prevMap = new Map(prev.map((r) => [r.materia, r]));
        const next = fromInicio.map((base) => {
          const old = prevMap.get(base.materia);
          return old ? { ...base, ...old, materia: base.materia } : base;
        });
        return next;
      });
    };

    const onFocus = (): void => syncFromInicio();
    const onCoursesUpdated = (): void => syncFromInicio();

    window.addEventListener("focus", onFocus);
    window.addEventListener("fiuna_current_courses_updated", onCoursesUpdated);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("fiuna_current_courses_updated", onCoursesUpdated);
    };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !userId) return;

    // Guardar en Supabase
    const saveToDB = async () => {
      try {
        const supabase = getSupabase();
        
        // Construir lista de exámenes a insertar
        const examsToInsert = [];
        for (const row of rows) {
          for (const t of TYPES) {
            const cell = row[t.key as keyof Row] as EvalCell;
            if (cell.fecha) {
              examsToInsert.push({
                user_id: userId,
                materia: row.materia,
                tipo: t.label,
                fecha: cell.fecha,
                hora: cell.hora || "",
              });
            }
          }
        }

        // Obtener exámenes actuales en la BD
        const { data: currentExams } = await supabase
          .from("student_exams")
          .select("id, materia, tipo, fecha, hora")
          .eq("user_id", userId);

        // Comparar y solo actualizar si hay cambios
        const currentSet = new Set(
          (currentExams || []).map(e => `${e.materia}|${e.tipo}|${e.fecha}|${e.hora}`)
        );
        const newSet = new Set(
          examsToInsert.map(e => `${e.materia}|${e.tipo}|${e.fecha}|${e.hora}`)
        );

        // Solo actualizar si hay diferencias
        if (currentSet.size !== newSet.size || 
            ![...currentSet].every(item => newSet.has(item))) {
          // Eliminar solo los que ya no existen
          const toDelete = (currentExams || []).filter(
            e => !newSet.has(`${e.materia}|${e.tipo}|${e.fecha}|${e.hora}`)
          );
          
          if (toDelete.length > 0) {
            for (const exam of toDelete) {
              await supabase.from("student_exams").delete().eq("id", exam.id);
            }
          }

          // Insertar nuevos exámenes
          if (examsToInsert.length > 0) {
            const toInsert = examsToInsert.filter(
              e => !currentSet.has(`${e.materia}|${e.tipo}|${e.fecha}|${e.hora}`)
            );
            if (toInsert.length > 0) {
              await supabase.from("student_exams").insert(toInsert);
            }
          }
        }
      } catch (error) {
        console.error("Error saving exams to DB:", error);
      }
    };

    saveToDB();

    // También guardar en localStorage para compatibilidad
    try {
      localStorage.setItem(EVAL_KEY, JSON.stringify(rows));
      try { window.dispatchEvent(new Event("fiuna_evaluaciones_updated")); } catch {}
    } catch {
      // ignore
    }
  }, [rows, loaded, userId]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(EVAL_EDITOR_OPEN_KEY, showEditor ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showEditor, loaded]);

  const setCell = (materia: string, typeKey: string, field: keyof EvalCell, value: string): void => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.materia !== materia) return r;
        const cur = (r?.[typeKey as keyof Row] as EvalCell) || { fecha: "", hora: "" };
        return { ...r, [typeKey]: { ...cur, [field]: value } };
      })
    );
  };

  const toggleOpen = (materia: string): void => {
    setOpenMateria((cur) => (cur === materia ? null : materia));
  };

  const materiaHasAnyData = (r: Row): boolean => {
    return TYPES.some((t) => {
      const c = r?.[t.key as keyof Row] as EvalCell | undefined;
      return Boolean((c?.fecha || "").trim() || (c?.hora || "").trim());
    });
  };

  const lists = useMemo<ExamList>(() => {
    const out: ExamList = {};
    for (const t of TYPES) {
      const items: ExamItem[] = [];
      rows.forEach((r) => {
        const cell = r?.[t.key as keyof Row] as EvalCell | undefined;
        const fecha = (cell?.fecha || "").trim();
        const hora = (cell?.hora || "").trim();
        const dt = parseDateTime(fecha, hora);
        if (!dt) return;

        let estado = "—";
        let dias: number | null = null;
        if (clientNow) {
          dias = Math.floor((dt.getTime() - clientNow.getTime()) / (1000 * 60 * 60 * 24));
          if (dias === 0) estado = "🟡 Hoy";
          else if (dias === 1) estado = "🟠 Mañana";
          else if (dias < 0) estado = "✅ Finalizado";
          else estado = `${dias} días`;
        }

        items.push({
          materia: r.materia,
          fecha,
          hora,
          dt,
          dias,
          estado,
        });
      });
      items.sort((a, b) => a.dt.getTime() - b.dt.getTime());
      out[t.key] = items;
    }
    return out;
  }, [rows, clientNow]);

  const titleFor = (key: string): string => {
    const found = TYPES.find((t) => t.key === key);
    return found ? found.label : key;
  };

  const hasAnyExam = useMemo<boolean>(() => {
    try {
      return Object.values(lists).some((arr) => Array.isArray(arr) && arr.length > 0);
    } catch {
      return false;
    }
  }, [lists]);

  const escapeHtml = (s: string | null | undefined): string =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const downloadPdf = (): void => {
    if (pdfBusy) return;
    if (!hasAnyExam) return;

    setPdfBusy(true);
    setTimeout(() => setPdfBusy(false), 900);

    const sections: SectionData[] = TYPES
      .map((t) => ({
        key: t.key,
        title: titleFor(t.key),
        items: lists[t.key] || [],
      }))
      .filter((s): s is SectionData => Array.isArray(s.items) && s.items.length > 0);

    const now = new Date();
    const stamp = now.toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const body = sections
      .map((sec) => {
        const rowsHtml = sec.items
          .map((it) => {
            const materia = escapeHtml(it.materia);
            const fecha = escapeHtml(formatLongES(it.fecha) || "—");
            const hora = escapeHtml(it.hora || "—");
            return `
            <tr>
              <td class="m">${materia}</td>
              <td class="f">${fecha}</td>
              <td class="h">${hora}</td>
            </tr>`;
          })
          .join("");

        return `
        <div class="sec">
          <div class="secTitle">${escapeHtml(String(sec.title).toUpperCase())}</div>
          <table>
            <thead>
              <tr>
                <th>Materia</th>
                <th>Fecha</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Horario de exámenes</title>
  <style>
    *{ box-sizing:border-box; }
    body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color:#0f172a; }
    .meta{ font-size:12px; color:#64748b; text-align:right; white-space:nowrap; margin-bottom: 10px; }

    .sec{ margin-top:14px; page-break-inside: avoid; }
    .secTitle{
      font-size:12px; font-weight:900; letter-spacing:.6px; text-align:center;
      padding:10px 12px; background: rgba(14,165,233,0.90); color:#fff; border-radius:12px;
    }

    table{ width:100%; border-collapse:collapse; margin-top:10px; }
    th, td{ border-bottom:1px solid rgba(15,23,42,0.10); padding:10px 10px; font-size:12px; vertical-align:top; }
    th{ background: rgba(14,165,233,0.12); text-transform:uppercase; letter-spacing:.5px; font-weight:900; }
    td.m{ font-weight:900; width:38%; }
    td.f{ width:44%; }
    td.h{ width:18%; white-space:nowrap; }

    .printBtn{
      border:1px solid rgba(15,23,42,0.15);
      background: rgba(14,165,233,0.12);
      padding:10px 12px;
      border-radius:12px;
      font-weight:900;
      cursor:pointer;
      margin-bottom:12px;
    }
    @media print{
      .printBtn{ display:none; }
      body{ margin: 14mm; }
      .secTitle{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      th{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <button class="printBtn" onclick="window.print()">Guardar como PDF</button>

  <div class="meta">Generado: ${escapeHtml(stamp)}<br/>S.I.G.A</div>

  ${body}
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    window.location.assign(url);
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Card
        title={<span className="sectionLabel">🧾 HORARIO DE EXÁMENES</span>}
        className={!showEditor ? "cardCompact" : ""}
        right={
          rows.length ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn btnSoft"
                onClick={downloadPdf}
                title="Descargar / Guardar como PDF"
                disabled={!hasAnyExam || pdfBusy}
                style={!hasAnyExam || pdfBusy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
              >
                {pdfBusy ? "Generando..." : "⬇ PDF"}
              </button>

              <button
                className="btn btnSoft"
                onClick={() => setShowEditor((v) => !v)}
                title={showEditor ? "Ocultar editor" : "Editar cronograma"}
              >
                {showEditor ? "▾ Ocultar editor" : "▸ Editar cronograma"}
              </button>
            </div>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <div className="muted" style={{ padding: 10 }}>
            No hay materias. Agregá materias en Inicio → "Materias en curso".
          </div>
        ) : showEditor ? (
          <div className="examEditorList">
            {rows.map((r) => {
              const isOpen = openMateria === r.materia;
              const hasData = materiaHasAnyData(r);
              const f3Data = r?.f3;
              const showF3 = Boolean(showFinal3[r.materia] || (f3Data?.fecha || "").trim() || (f3Data?.hora || "").trim());

              return (
                <div key={r.materia} className="examMateriaCard">
                  <div className="examMateriaHeader">
                    <div className="examMateriaName">{r.materia}</div>

                    <div className="examMateriaActions">
                      <button
                        className="btn btnSoft"
                        onClick={() => toggleOpen(r.materia)}
                        title={isOpen ? "Ocultar" : "Mostrar"}
                      >
                        {isOpen ? "▾ Ocultar" : "▸ Añadir horario de examen"}
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="examEditorBody">
                      <div className="examInputsGrid">
                        {["p1", "p2", "f1", "f2"].map((k) => (
                          <div key={k} className="examRow">
                            <div className="examType">{titleFor(k)}</div>

                            <div className="examField">
                              <span className="examLabel">FECHA:</span>
                              <input
                                className="examInput"
                                type="date"
                                value={(r?.[k as keyof Row] as EvalCell)?.fecha || ""}
                                onChange={(e) => setCell(r.materia, k, "fecha", e.target.value)}
                              />
                            </div>

                            <div className="examField">
                              <span className="examLabel">HORA:</span>
                              <input
                                className="examInput"
                                type="time"
                                value={(r?.[k as keyof Row] as EvalCell)?.hora || ""}
                                onChange={(e) => setCell(r.materia, k, "hora", e.target.value)}
                              />
                            </div>
                          </div>
                        ))}

                        {showF3 ? (
                          <div className="examRow">
                            <div className="examType">{titleFor("f3")}</div>

                            <div className="examField">
                              <span className="examLabel">FECHA:</span>
                              <input
                                className="examInput"
                                type="date"
                                value={r?.f3?.fecha || ""}
                                onChange={(e) => setCell(r.materia, "f3", "fecha", e.target.value)}
                              />
                            </div>

                            <div className="examField">
                              <span className="examLabel">HORA:</span>
                              <input
                                className="examInput"
                                type="time"
                                value={r?.f3?.hora || ""}
                                onChange={(e) => setCell(r.materia, "f3", "hora", e.target.value)}
                              />
                            </div>

                            <div className="examField examRowRight">
                              <button
                                className="btn btnGhost"
                                onClick={() => {
                                  const f = (r?.f3?.fecha || "").trim();
                                  const h = (r?.f3?.hora || "").trim();
                                  if (!f && !h) {
                                    setShowFinal3((prev) => ({ ...prev, [r.materia]: false }));
                                  }
                                }}
                                title="Ocultar Final 3 (solo si está vacío)"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="examFinal3Add">
                            <button
                              className="btn btnGhost"
                              onClick={() => setShowFinal3((prev) => ({ ...prev, [r.materia]: true }))}
                            >
                              ➕ Agregar Final 3 (solo si existe)
                            </button>
                          </div>
                        )}
                      </div>

                      {hasData ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                          Tip: si ya completaste, podés tocar <b>"Ocultar"</b> y queda guardado.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>

      {Object.values(lists).some((arr) => arr.length > 0) ? (
        <div className="grid" style={{ gap: 14 }}>
          {TYPES.map((t) => {
            const items = lists[t.key] || [];
            if (!items.length) return null;

            return (
              <div key={t.key} className="examSummaryCard">
                <div className="examSummaryTitle">{titleFor(t.key).toUpperCase()}</div>

                <div className="examSummaryWrap">
                  <div className="examSummaryTable">
                    <div className="examSummaryTh">📚 MATERIA</div>
                    <div className="examSummaryTh">📅 FECHA</div>
                    <div className="examSummaryTh">⏰ HORA</div>
                    <div className="examSummaryTh">🗓️ DÍAS RESTANTES</div>

                    {items.map((it) => (
                      <React.Fragment key={`${t.key}-${it.materia}-${it.fecha}-${it.hora}`}>
                        <div className="examSummaryTd examSummaryMateria">{it.materia}</div>
                        <div className="examSummaryTd">{formatLongES(it.fecha) || "—"}</div>
                        <div className="examSummaryTd">{it.hora || "—"}</div>
                        <div className="examSummaryTd">{it.estado}</div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}