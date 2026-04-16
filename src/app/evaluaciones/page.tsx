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

function parseDateTime(dateYMD: string, timeHM?: string): Date | null {
  if (!dateYMD) return null;
  const t = (timeHM || "00:00").trim();
  const iso = `${dateYMD}T${t}:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
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

function daysDiffFromDate(base: Date, target: Date): number {
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function buildFromInicioCourses(): Row[] {
  if (typeof window === "undefined") return [];
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

  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [pdfBusy, setPdfBusy] = useState<boolean>(false);
  const [savingEditor, setSavingEditor] = useState<boolean>(false);

  const [editorRows, setEditorRows] = useState<Row[]>([]);
  const [editorShowFinal3, setEditorShowFinal3] = useState<{ [key: string]: boolean }>({});

  const [clientNow, setClientNow] = useState<Date | null>(null);

  useEffect(() => {
    setClientNow(new Date());
  }, []);

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

  useEffect(() => {
    if (!userId) return;

    const loadExams = async () => {
      try {
        const supabase = getSupabase();

        const { data: coursesData } = await supabase
          .from("student_courses")
          .select("id, materia")
          .eq("user_id", userId);

        const courses = coursesData ? coursesData.map((c) => c.materia) : [];

        const { data: exams } = await supabase
          .from("student_exams")
          .select("materia, tipo, fecha, hora")
          .eq("user_id", userId);

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

        if (exams && exams.length > 0) {
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
            const typeKey = TYPES.find((t) => t.label === exam.tipo)?.key;
            if (typeKey) {
              (row as any)[typeKey] = { fecha: exam.fecha, hora: exam.hora };
            }
          }
        }

        setRows(Array.from(rowMap.values()));
      } catch (error) {
        console.error("Error loading exams:", error);
        setRows([]);
      } finally {
        setLoaded(true);
      }
    };

    loadExams();
  }, [userId]);

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
        async () => {
          try {
            const { data: coursesData } = await supabase
              .from("student_courses")
              .select("id, materia")
              .eq("user_id", userId);

            const courses = coursesData ? coursesData.map((c) => c.materia) : [];

            const { data: exams } = await supabase
              .from("student_exams")
              .select("materia, tipo, fecha, hora")
              .eq("user_id", userId);

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

            if (exams && exams.length > 0) {
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
                const typeKey = TYPES.find((t) => t.label === exam.tipo)?.key;
                if (typeKey) {
                  (row as any)[typeKey] = { fecha: exam.fecha, hora: exam.hora };
                }
              }
            }

            setRows(Array.from(rowMap.values()));
          } catch (error) {
            console.error("Error reloading exams:", error);
          }
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

  const materiaHasAnyData = (r: Row): boolean => {
    return TYPES.some((t) => {
      const c = r?.[t.key as keyof Row] as EvalCell | undefined;
      return Boolean((c?.fecha || "").trim() || (c?.hora || "").trim());
    });
  };

  const openEditorModal = (): void => {
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn("No rows available to edit");
      return;
    }

    const cloned = rows.map((r) => ({
      materia: r.materia,
      p1: { fecha: r.p1?.fecha || "", hora: r.p1?.hora || "" },
      p2: { fecha: r.p2?.fecha || "", hora: r.p2?.hora || "" },
      f1: { fecha: r.f1?.fecha || "", hora: r.f1?.hora || "" },
      f2: { fecha: r.f2?.fecha || "", hora: r.f2?.hora || "" },
      f3: { fecha: r.f3?.fecha || "", hora: r.f3?.hora || "" },
    }));

    const initialShowFinal3: { [key: string]: boolean } = {};
    cloned.forEach((r) => {
      initialShowFinal3[r.materia] = Boolean(
        (r.f3?.fecha || "").trim() || (r.f3?.hora || "").trim()
      );
    });

    setEditorRows(cloned);
    setEditorShowFinal3(initialShowFinal3);
    setShowEditor(true);
  };

  const closeEditorModal = (): void => {
    if (savingEditor) return;
    setShowEditor(false);
  };

  const setEditorCell = (
    materia: string,
    typeKey: string,
    field: keyof EvalCell,
    value: string
  ): void => {
    setEditorRows((prev) =>
      prev.map((r) => {
        if (r.materia !== materia) return r;
        const cur = (r?.[typeKey as keyof Row] as EvalCell) || { fecha: "", hora: "" };
        return { ...r, [typeKey]: { ...cur, [field]: value } };
      })
    );
  };

  const saveEditorToDB = async (): Promise<void> => {
    if (!userId) return;

    try {
      setSavingEditor(true);
      const supabase = getSupabase();

      const examsToInsert: Array<{
        user_id: string;
        materia: string;
        tipo: string;
        fecha: string;
        hora: string;
      }> = [];

      for (const row of editorRows) {
        for (const t of TYPES) {
          if (t.key === "f3" && !editorShowFinal3[row.materia]) continue;

          const cell = row[t.key as keyof Row] as EvalCell;
          const fecha = (cell?.fecha || "").trim();
          const hora = (cell?.hora || "").trim();

          if (!fecha) continue;

          examsToInsert.push({
            user_id: userId,
            materia: row.materia,
            tipo: t.label,
            fecha,
            hora,
          });
        }
      }

      const { error: deleteError } = await supabase
        .from("student_exams")
        .delete()
        .eq("user_id", userId);

      if (deleteError) {
        console.error("Error deleting exams:", deleteError);
        return;
      }

      if (examsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("student_exams")
          .insert(examsToInsert);

        if (insertError) {
          console.error("Error inserting exams:", insertError);
          return;
        }
      }

      setRows(editorRows);

      try {
        localStorage.setItem(EVAL_KEY, JSON.stringify(editorRows));
        try {
          window.dispatchEvent(new Event("fiuna_evaluaciones_updated"));
        } catch { }
      } catch { }

      setShowEditor(false);
    } catch (error) {
      console.error("Error saving editor exams:", error);
    } finally {
      setSavingEditor(false);
    }
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
          dias = daysDiffFromDate(clientNow, dt);

          if (dias < 0) estado = "✅ Finalizado";
          else if (dias === 0) estado = "🟡 Hoy";
          else if (dias === 1) estado = "🟠 Mañana";
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
        className="cardCompact"
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
                onClick={openEditorModal}
                title="Editar cronograma"
              >
                ▸ Editar cronograma
              </button>
            </div>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <div className="muted" style={{ padding: 10 }}>
            No hay materias. Agregá materias en Inicio → "Materias en curso".
          </div>
        ) : null}
      </Card>

      {showEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            zIndex: 9999,
            padding: "56px 16px 20px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "min(1180px, 100%)",
              maxHeight: "88vh",
              overflow: "hidden",
              background: "#fff",
              borderRadius: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
              border: "1px solid rgba(15,23,42,0.08)",
              display: "grid",
              gridTemplateRows: "auto 1fr auto",
            }}
          >
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid rgba(15,23,42,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>
                  Editar cronograma de exámenes
                </div>
                <div style={{ fontSize: 13, color: "rgba(15,23,42,0.65)", marginTop: 4 }}>
                  Completa todo y guarda al final.
                </div>
              </div>
              <button
                className="btn"
                onClick={closeEditorModal}
                disabled={savingEditor}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                overflowY: "auto",
                padding: 20,
                display: "grid",
                gap: 18,
                background: "#f8fafc",
              }}
            >
              {!editorRows || editorRows.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 300,
                    color: "#64748b",
                    fontSize: 14,
                  }}
                >
                  No hay materias disponibles.
                </div>
              ) : (
                editorRows.map((r, idx) => {
                const showF3 = Boolean(
                  editorShowFinal3[r.materia] ||
                  (r.f3?.fecha || "").trim() ||
                  (r.f3?.hora || "").trim()
                );

                const editorTypes = TYPES.filter((t) => t.key !== "f3" || showF3);

                return (
                  <div
                    key={`${r.materia || "MATERIA VACÍA"}-${idx}`}
                    style={{
                      border: "1px solid #dbe2ea",
                      borderRadius: 18,
                      background: "#ffffff",
                      overflow: "hidden",
                      boxShadow: "0 2px 10px rgba(15,23,42,0.04)",
                    }}
                  >
                    <div
                      style={{
                        padding: "16px 18px",
                        borderBottom: "1px solid #e5e7eb",
                        fontWeight: 900,
                        fontSize: 18,
                        color: "#0f172a",
                        background: "#ffffff",
                      }}
                    >
                      {r.materia || "Materia"}
                    </div>

                    <div style={{ padding: 16 }}>
                      <div
                        style={{
                          overflowX: "auto",
                          overflowY: "hidden",
                          paddingBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridAutoFlow: "column",
                            gridAutoColumns: "240px",
                            gap: 14,
                            minWidth: "max-content",
                            alignItems: "stretch",
                          }}
                        >
                          {editorTypes.map((t) => {
                            const cell = (r[t.key as keyof Row] as EvalCell) || {
                              fecha: "",
                              hora: "",
                            };

                            return (
                              <div
                                key={`${r.materia}-${t.key}`}
                                style={{
                                  border: "1px solid #dbe2ea",
                                  borderRadius: 16,
                                  padding: 14,
                                  display: "grid",
                                  gap: 12,
                                  background: "#f8fafc",
                                  minHeight: 220,
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 900,
                                    fontSize: 15,
                                    color: "#0f172a",
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {t.label}
                                </div>
                                <div
                                  style={{
                                    display: "grid",
                                    gap: 6,
                                    alignContent: "start",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: "#475569",
                                      letterSpacing: ".3px",
                                    }}
                                  >
                                    FECHA
                                  </div>
                                  <input
                                    className="examInput"
                                    type="date"
                                    value={cell.fecha || ""}
                                    onChange={(e) =>
                                      setEditorCell(r.materia, t.key, "fecha", e.target.value)
                                    }
                                    style={{
                                      width: "100%",
                                      minHeight: 44,
                                      borderRadius: 12,
                                      border: "1px solid #cbd5e1",
                                      background: "#ffffff",
                                      color: "#0f172a",
                                      padding: "10px 12px",
                                    }}
                                  />
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gap: 6,
                                    alignContent: "start",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: "#475569",
                                      letterSpacing: ".3px",
                                    }}
                                  >
                                    HORA
                                  </div>
                                  <input
                                    className="examInput"
                                    type="time"
                                    value={cell.hora || ""}
                                    onChange={(e) =>
                                      setEditorCell(r.materia, t.key, "hora", e.target.value)
                                    }
                                    style={{
                                      width: "100%",
                                      minHeight: 44,
                                      borderRadius: 12,
                                      border: "1px solid #cbd5e1",
                                      background: "#ffffff",
                                      color: "#0f172a",
                                      padding: "10px 12px",
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {!showF3 && (
                            <div
                              style={{
                                border: "1px dashed #cbd5e1",
                                borderRadius: 16,
                                padding: 14,
                                display: "grid",
                                alignContent: "center",
                                minHeight: 220,
                                background: "#ffffff",
                              }}
                            >
                              <button
                                className="btn btnGhost"
                                onClick={() =>
                                  setEditorShowFinal3((prev) => ({
                                    ...prev,
                                    [r.materia]: true,
                                  }))
                                }
                              >
                                ➕ Agregar Final 3
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
              )}
            </div>

            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid rgba(15,23,42,0.08)",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                onClick={closeEditorModal}
                disabled={savingEditor}
              >
                Cancelar
              </button>

              <button
                className="btn btnPrimary"
                onClick={saveEditorToDB}
                disabled={savingEditor}
              >
                {savingEditor ? "Guardando..." : "Guardar cronograma"}
              </button>
            </div>
          </div>
        </div>
      )}

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