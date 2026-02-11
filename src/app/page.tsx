"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/Card";
import { supabase } from "@/lib/supabaseClient";
import { Session } from "@supabase/supabase-js";

/* =========================================================
   CONSTANTES
========================================================= */
const CARRERAS = [
  "Ingeniería Geográfica y Ambiental",
  "Ingeniería Electromecánica",
  "Ingeniería Electrónica",
  "Ingeniería Mecánica",
  "Ingeniería Mecatrónica",
  "Ingeniería Industrial",
  "Ingeniería Civil",
];

/* =========================================================
   TIPOS
========================================================= */
type Profile = {
  alumno: string;
  ci: string;
  carrera: string;
  malla: string;
  ingreso: string;
  user_id?: string;
};

type CourseRow = {
  id?: string;
  semestre: string;
  materia: string;
  firma: string;
};

type ExamData = {
  id?: string;
  materia: string;
  tipo: string;
  fecha: string;
  hora: string;
};

type StudentNote = {
  id?: string;
  materia: string;
  nota1: number | null;
  nota2: number | null;
  nota3: number | null;
};

type ClassRow = {
  id?: string;
  dia: number;
  materia: string;
  tipo: string;
  seccion: string;
  horaInicio: string;
  horaFin: string;
  profesor?: string;
};

type AcademicEvent = {
  id?: string;
  fecha: string;
  evento: string;
};

/* =========================================================
   VALORES POR DEFECTO
========================================================= */
const DEFAULT_PROFILE: Profile = {
  alumno: "",
  ci: "",
  carrera: CARRERAS[0],
  malla: "2023",
  ingreso: "",
};

/* =========================================================
   FUNCIONES HELPER
========================================================= */
function normText(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDateTime(dateYMD: string, timeHM: string): Date | null {
  if (!dateYMD) return null;
  const t = (timeHM || "00:00").trim();
  const dt = new Date(`${dateYMD}T${t}:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function daysDiffFromToday(dt: Date): number {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function formatDMY(dateYMD: string): string {
  if (!dateYMD) return "";
  const [y, m, d] = String(dateYMD).split("-");
  if (!y || !m || !d) return String(dateYMD);
  return `${d}/${m}/${y}`;
}

function dayIdFromISO(iso: string): number {
  try {
    const d = new Date(iso + "T00:00:00");
    const js = d.getDay();
    if (js === 0) return 6;
    return Math.min(js, 6);
  } catch {
    return 1;
  }
}

async function computeNotasKpis(
  userId: string,
  carrera: string
): Promise<{ promedioStr: string; aprobadas: number; total: number; progresoPct: number; faltan: number }> {
  try {
    const { data: notes } = await supabase
      .from("student_notes")
      .select("materia, nota1, nota2, nota3")
      .eq("user_id", userId);

    const { data: courses } = await supabase
      .from("student_courses")
      .select("materia")
      .eq("user_id", userId);

    const materiasCurso = new Set((courses || []).map((c) => normText(c.materia || "")));
    const todasLasNotas: number[] = [];
    const aprobadaByMateria = new Map<string, boolean>();

    for (const n of notes || []) {
      const matKey = normText(n.materia || "");
      if (!matKey) continue;

      const vals = [n.nota1, n.nota2, n.nota3]
        .map((x) => (x === null || x === undefined ? null : Number(x)))
        .filter((x) => x !== null && Number.isFinite(x) && x >= 1 && x <= 5) as number[];

      for (const v of vals) todasLasNotas.push(v);
      if (vals.some((v) => v >= 2)) aprobadaByMateria.set(matKey, true);
    }

    const promedioNum = todasLasNotas.length
      ? todasLasNotas.reduce((a, b) => a + b, 0) / todasLasNotas.length
      : 0;

    const aprobadas = Array.from(materiasCurso).reduce(
      (acc, k) => acc + (aprobadaByMateria.get(k) ? 1 : 0),
      0
    );

    const total = materiasCurso.size || 0;
    const progresoPct = total ? (aprobadas / total) * 100 : 0;
    const faltan = Math.max(0, total - aprobadas);

    return {
      promedioStr: promedioNum ? promedioNum.toFixed(2).replace(".", ",") : "0,00",
      aprobadas,
      total,
      progresoPct,
      faltan,
    };
  } catch {
    return { promedioStr: "0,00", aprobadas: 0, total: 0, progresoPct: 0, faltan: 0 };
  }
}

async function computeNextExam(userId: string): Promise<{
  materia: string;
  tipo: string;
  fecha: string;
  hora: string;
  dias: number;
} | null> {
  try {
    const { data: exams } = await supabase
      .from("student_exams")
      .select("materia, tipo, fecha, hora")
      .eq("user_id", userId);

    if (!exams || exams.length === 0) return null;

    const TIPOS_ORDER: { [key: string]: number } = {
      "1er Parcial": 1,
      "2do Parcial": 2,
      "Final 1": 3,
      "Final 2": 4,
      "Final 3": 5,
    };

    let best: any = null;
    for (const exam of exams) {
      const dt = parseDateTime(exam.fecha, exam.hora);
      if (!dt) continue;
      const dias = daysDiffFromToday(dt);
      if (dias < 0) continue;

      const cand = { materia: exam.materia, tipo: exam.tipo, fecha: exam.fecha, hora: exam.hora, dt, dias };
      if (!best || cand.dt.getTime() < best.dt.getTime()) best = cand;
    }

    if (!best) return null;

    return {
      materia: best.materia,
      tipo: best.tipo,
      fecha: formatDMY(best.fecha),
      hora: best.hora || "â€”",
      dias: best.dias,
    };
  } catch {
    return null;
  }
}

async function loadAcademicEvents(date: string): Promise<string[]> {
  try {
    const { data: events } = await supabase
      .from("academic_calendar")
      .select("evento")
      .eq("fecha", date);

    return (events || []).map((e) => e.evento).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadScheduleForDay(userId: string, dayId: number): Promise<ClassRow[]> {
  try {
    const { data: classes } = await supabase
      .from("student_schedule")
      .select("id, dia, materia, tipo, seccion, horaInicio, horaFin, profesor")
      .eq("user_id", userId)
      .eq("dia", dayId);

    return (classes || []) as ClassRow[];
  } catch {
    return [];
  }
}


/* =========================================================
   PAGE PRINCIPAL
========================================================= */
export default function Page() {
  const router = useRouter();

  /* =======================================================
     ESTADOS GENERALES
  ======================================================== */
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  /* =======================================================
     ESTADOS PERFIL
  ======================================================== */
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [profileDraft, setProfileDraft] = useState<Profile>(DEFAULT_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);
  const [toastProfile, setToastProfile] = useState("");

  /* =======================================================
     ESTADOS MATERIAS
  ======================================================== */
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [toastCourses, setToastCourses] = useState("");

  /* =======================================================
     ESTADOS EXÃMENES Y NOTAS
  ======================================================== */
  const [nextExam, setNextExam] = useState<{
    materia: string;
    tipo: string;
    fecha: string;
    hora: string;
    dias: number;
  } | null>(null);
  const [notasKpis, setNotasKpis] = useState({
    promedioStr: "0,00",
    aprobadas: 0,
    total: 0,
    progresoPct: 0,
    faltan: 0,
  });

  /* =======================================================
     ESTADOS CALENDARIO Y HORARIO
  ======================================================== */
  const [academicEvents, setAcademicEvents] = useState<string[]>([]);
  const [classesForDay, setClassesForDay] = useState<ClassRow[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [useTestDate, setUseTestDate] = useState(false);
  const [testDateISO, setTestDateISO] = useState("");

  /* =======================================================
     ESTADOS AULAS
  ======================================================== */
  const [aulasOn, setAulasOn] = useState(false);
  const [aulasLoading, setAulasLoading] = useState(false);
  const [aulasInfo, setAulasInfo] = useState<{ [key: string]: any }>({});
  const [aulasError, setAulasError] = useState("");
  const [aulasBtnState, setAulasBtnState] = useState<"idle" | "loading" | "success">("idle");

  
  /* =======================================================
     EFECTO: AUTENTICACIÃ“N + CARGA PERFIL + EXÃMENES + NOTAS
  ======================================================== */
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.push("/auth");
        return;
      }

      setSession(data.session);

      const uid = data.session.user.id;

      /* --- cargar perfil desde Supabase --- */
      const { data: profileData } = await supabase
        .from("user_profiles")
        .select("alumno, ci, carrera, malla, ingreso, user_id")
        .eq("user_id", uid)
        .single();

      if (profileData) {
        setProfile(profileData);
        setProfileDraft(profileData);
      }

      /* --- cargar materias desde Supabase --- */
      const { data: coursesData } = await supabase
        .from("student_courses")
        .select("id, semestre, materia, firma")
        .eq("user_id", uid)
        .order("semestre", { ascending: true });

      if (coursesData) {
        setCourses(
          coursesData.map((c) => ({
            id: c.id,
            semestre: String(c.semestre ?? ""),
            materia: c.materia ?? "",
            firma: c.firma ?? "",
          }))
        );
      }

      /* --- cargar próximo examen --- */
      const nextExamData = await computeNextExam(uid);
      setNextExam(nextExamData);

      /* --- cargar KPIs de notas --- */
      const kpis = await computeNotasKpis(uid, profileData?.carrera || "");
      setNotasKpis(kpis);

      setLoading(false);
      setLoadingCourses(false);
    };

    load();

    // ✅ AGREGAR LISTENER DE SESIÓN
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          router.push("/auth");
        }
        setSession(session);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const userId = session?.user.id;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth");
  };

  /* =======================================================
     EFECTO: INICIALIZAR FECHA DE HOY
  ======================================================== */
  useEffect(() => {
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const todayISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    setTestDateISO(todayISO);
  }, []);

  /* =======================================================
     EFECTO: CARGAR EVENTOS ACADÉMICOS Y CLASES DEL DÍA
  ======================================================== */
  useEffect(() => {
    if (!userId || !testDateISO) return;

    const load = async () => {
      setLoadingClasses(true);

      /* --- cargar eventos académicos --- */
      const events = await loadAcademicEvents(testDateISO);
      setAcademicEvents(events);

      /* --- cargar clases del día --- */
      const dayId = dayIdFromISO(useTestDate ? testDateISO : testDateISO);
      const classes = await loadScheduleForDay(userId, dayId);
      setClassesForDay(classes);

      setLoadingClasses(false);
    };

    load();
  }, [userId, testDateISO, useTestDate]);

  /* =======================================================
     EFECTO: REFRESCAR NOTAS CUANDO CAMBIA EL PERFIL
  ======================================================== */
  useEffect(() => {
    if (!userId || !profile.carrera) return;

    const refreshKpis = async () => {
      const kpis = await computeNotasKpis(userId, profile.carrera);
      setNotasKpis(kpis);
    };

    refreshKpis();
  }, [userId, profile.carrera]);

  /* =======================================================
     FUNCIONES PERFIL
  ======================================================== */
  const onGuardarPerfil = async () => {
    if (!userId) return;

    setSavingProfile(true);
    setToastProfile("");

    const payload = {
      user_id: userId,
      alumno: profileDraft.alumno,
      ci: profileDraft.ci,
      carrera: profileDraft.carrera,
      malla: profileDraft.malla,
      ingreso: profileDraft.ingreso,
      updated_at: new Date().toISOString(),
    };

const { error } = await supabase
  .from("user_profiles")
  .update({
    alumno: profileDraft.alumno,
    ci: profileDraft.ci,
    carrera: profileDraft.carrera,
    malla: profileDraft.malla,
    ingreso: profileDraft.ingreso,
    updated_at: new Date().toISOString(),
  })
  .eq("user_id", userId);

    if (error) {
      setToastProfile("❌ No se pudo guardar el perfil");
    } else {
      setProfile(profileDraft);
      setToastProfile("✅ Datos guardados");
      setTimeout(() => setToastProfile(""), 2500);
    }

    setSavingProfile(false);
  };

  /* =======================================================
     FUNCIÓN: REFRESCAR AULAS
  ======================================================== */
  const refreshAulas = async () => {
    const startedAt = Date.now();
    let shouldShowSuccess = false;

    try {
      setAulasError("");
      setAulasLoading(true);
      setAulasBtnState("loading");

      if (classesForDay.length === 0) {
        const msg = "Hoy no hay clases cargadas en tu Horario, por eso no se consultan aulas.";
        setAulasError(msg);
        if (typeof window !== "undefined") window.alert(msg);
        return;
      }

      const payload = {
        classes: classesForDay.map((c) => ({
          key: `${c.horaInicio}|${c.horaFin}|${c.materia}|${c.tipo}-${c.seccion}`,
          materia: c.materia,
          tipo: c.tipo,
          seccion: c.seccion,
          horaInicio: c.horaInicio,
        })),
      };

      const r = await fetch("/api/aulas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await r.json();
      } catch {
        data = null;
      }

      if (!r.ok || data?.ok === false) {
        const base = data?.error || data?.message || "No se pudo conectar a la BD de aulas";
        const msg = `${base}\n\nPosibles causas:\n• Tu Google Sheet NO está público\n• El gid no corresponde\n• Problema de red`;
        setAulasError(msg);
        if (typeof window !== "undefined") window.alert(msg);
        return;
      }

      if (data?.results && typeof data.results === "object") setAulasInfo(data.results);

      shouldShowSuccess = true;
      setAulasOn(true);
    } catch (e) {
      const msg = `No se pudo conectar a la BD de aulas.\nDebug: ${e instanceof Error ? e.message : "Error"}`;
      setAulasError(msg);
      console.error(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 3000 - elapsed);
      if (wait) await new Promise((res) => setTimeout(res, wait));

      setAulasLoading(false);

      if (shouldShowSuccess) {
        setAulasBtnState("success");
        if (typeof window !== "undefined") {
          window.clearTimeout((window as any).__fiunaAulasBtnT);
          (window as any).__fiunaAulasBtnT = window.setTimeout(() => setAulasBtnState("idle"), 2000);
        } else {
          setAulasBtnState("idle");
        }
      } else {
        setAulasBtnState("idle");
      }
    }
  };

  /* =======================================================
     FUNCIONES MATERIAS
  ======================================================== */
  const addRow = () => {
    setCourses((prev) => [...prev, { semestre: "", materia: "", firma: "" }]);
  };

  const updateRow = (idx: number, patch: Partial<CourseRow>) => {
    setCourses((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  };

  const removeRow = (idx: number) => {
    setCourses((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveCourses = async () => {
    if (!userId) return;

    const clean = courses
      .map((c) => ({
        semestre: Number(c.semestre) || null,
        materia: c.materia.trim(),
        firma: c.firma || null,
      }))
      .filter((c) => c.materia);

    // borrar y reinsertar
    await supabase.from("student_courses").delete().eq("user_id", userId);

    if (clean.length) {
      await supabase.from("student_courses").insert(
        clean.map((c) => ({ ...c, user_id: userId }))
      );
    }

    setToastCourses(
      clean.length
        ? `Guardado (${clean.length} materias)`
        : "No hay materias para guardar"
    );

    setTimeout(() => setToastCourses(""), 2500);
  };

  /* =======================================================
     RENDER
  ======================================================== */
  if (loading) return <div>Cargando...</div>;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="dashGrid">

        {/* ===============================================
            PERFIL DEL ESTUDIANTE
        ================================================ */}
        <div className="blockProfile">
          <Card
            title={<span className="sectionLabel">🎓 PERFIL DEL ESTUDIANTE</span>}
            right={
              <button
                className="btn btnPrimary"
                onClick={onGuardarPerfil}
                disabled={savingProfile}
                style={{ padding: "8px 10px", fontWeight: 950 }}
              >
                {savingProfile ? "Guardando…" : "Guardar"}
              </button>
            }
          >
            <div className="smallRow">
              <div className="smallKey">Alumno:</div>
              <input
                className="fakeInput profileField"
                value={profileDraft.alumno}
                onChange={(e) =>
                  setProfileDraft((p) => ({ ...p, alumno: e.target.value }))
                }
                placeholder="Nombre y apellido"
              />
            </div>

            <div className="smallRow">
              <div className="smallKey">C.I. N°:</div>
              <input
                className="fakeInput profileField"
                value={profileDraft.ci}
                onChange={(e) =>
                  setProfileDraft((p) => ({ ...p, ci: e.target.value }))
                }
                placeholder="CI"
                inputMode="numeric"
              />
            </div>

            <div className="smallRow">
              <div className="smallKey">Carrera:</div>
              <div className="fakeInput fakeSelect">
                <select
                  className="profileSelect"
                  value={profileDraft.carrera}
                  onChange={(e) =>
                    setProfileDraft((p) => ({ ...p, carrera: e.target.value }))
                  }
                >
                  {CARRERAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="muted">▼</span>
              </div>
            </div>

            <div className="smallRow">
              <div className="smallKey">Malla:</div>
              <div className="fakeInput fakeSelect">
                <select
                  className="profileSelect"
                  value={profileDraft.malla}
                  onChange={(e) =>
                    setProfileDraft((p) => ({ ...p, malla: e.target.value }))
                  }
                >
                  <option value="2013">2013</option>
                  <option value="2023">2023</option>
                </select>
                <span className="muted">▼</span>
              </div>
            </div>

            <div className="smallRow">
              <div className="smallKey">Ingreso:</div>
              <input
                className="fakeInput profileField"
                value={profileDraft.ingreso}
                onChange={(e) =>
                  setProfileDraft((p) => ({ ...p, ingreso: e.target.value }))
                }
                placeholder="Año (ej: 2026)"
                inputMode="numeric"
              />
            </div>

            {toastProfile && (
              <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                {toastProfile}
              </div>
            )}
          </Card>
        </div>

        {/* ===============================================
            PRÓXIMO EXAMEN
        ================================================ */}
        <div className="blockProximo">
          <Card title={<span className="sectionLabel">⏱️ PRÓXIMO EXAMEN</span>}>
            <div className="bigDays">{nextExam ? `${nextExam.dias} días` : "—"}</div>
            <div className="centerNote">Días Restantes</div>
            <div style={{ height: 10 }} />
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 950 }}>📅 {nextExam ? nextExam.tipo : "Sin examen"}</div>
              <div style={{ fontWeight: 900, textTransform: "lowercase" }}>
                {(nextExam ? nextExam.materia : "Cargá tus fechas en Horario de Exámenes").toLowerCase()}
              </div>
              <div className="metaLine">
                <span>🗓️ {nextExam ? nextExam.fecha : "—"}</span>
                <span>⏰ {nextExam ? nextExam.hora : "—"}</span>
              </div>
            </div>
          </Card>
        </div>
        {/* ===============================================
            MATERIAS EN CURSO
        ================================================ */}
        <div className="blockMaterias">
          <Card
            title={<span className="sectionLabel"> 📚 Materias en curso</span>}
            right={
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" onClick={addRow}>
                  + Agregar
                </button>
                <button className="btn btnPrimary" onClick={saveCourses}>
                  Guardar
                </button>
              </div>
            }
          >
            {loadingCourses ? (
              <div className="muted">Cargando materias…</div>
            ) : (
              <>
                <table className="tableMini">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Semestre</th>
                      <th>Materia</th>
                      <th style={{ width: 120 }}>Firma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            className="fakeInput"
                            value={c.semestre}
                            onChange={(e) =>
                              updateRow(idx, { semestre: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="fakeInput"
                            value={c.materia}
                            onChange={(e) =>
                              updateRow(idx, { materia: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            <select
                              className="fakeInput"
                              value={c.firma}
                              onChange={(e) =>
                                updateRow(idx, { firma: e.target.value })
                              }
                            >
                              <option value="">—</option>
                              <option value="SI">SI</option>
                              <option value="NO">NO</option>
                            </select>
                            <button
                              className="btn"
                              onClick={() => removeRow(idx)}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!courses.length && (
                  <div className="muted" style={{ marginTop: 10 }}>
                    Aún no cargaste materias.
                  </div>
                )}

                {toastCourses && (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {toastCourses}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
        {/* ===============================================
            AVANCE ACADÉMICO
        ================================================ */}
        <div className="blockAvance">
          <Card
            title={<span className="sectionLabel">🚀 AVANCE ACADÉMICO</span>}
            right={<span className="pill mono">Promedio&nbsp;{notasKpis.promedioStr}</span>}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 900, color: "rgba(15,23,42,0.7)" }}>Aprobadas</div>
                <div style={{ fontWeight: 950, fontSize: 18 }}>{notasKpis.aprobadas}/{notasKpis.total}</div>
              </div>

              <div className="progressBar" aria-label="Barra de progreso">
                <div className="progressFill" style={{ width: `${Math.round(notasKpis.progresoPct || 0)}%` }} />
              </div>

              <div className="metaLine" style={{ justifyContent: "space-between" }}>
                <span>Progreso: <span className="mono">{Math.round(notasKpis.progresoPct || 0)}%</span></span>
                <span>Faltan: <span className="mono">{notasKpis.faltan}</span></span>
              </div>
            </div>
          </Card>
        </div>

        {/* ===============================================
            CLASES DE HOY
        ================================================ */}
        <div className="blockClases" id="clases-hoy">
          <Card
            title={<span className="sectionLabel">📅 CLASES DE HOY</span>}
            right={
              <button
                className={`btn btnPrimary${aulasBtnState === "success" ? " btnSuccess" : ""}`}
                onClick={refreshAulas}
                disabled={aulasLoading}
                style={{ padding: "8px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {aulasLoading ? <span className="miniSpinner" aria-hidden /> : null}
                <span>Actualizar</span>
              </button>
            }
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
              <div style={{ fontStyle: "italic", textAlign: "left", fontWeight: 900 }}>
                {new Date(`${useTestDate ? testDateISO : testDateISO}T00:00:00`).toLocaleDateString("es-PY", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
                  <input
                    type="checkbox"
                    checked={useTestDate}
                    onChange={(e) => setUseTestDate(e.target.checked)}
                  />
                  Modo prueba
                </label>
                {useTestDate && (
                  <input
                    type="date"
                    value={testDateISO}
                    onChange={(e) => setTestDateISO(e.target.value)}
                    className="input"
                    style={{ maxWidth: 160, padding: "8px 10px" }}
                  />
                )}
              </div>
            </div>

            {aulasError ? (
              <div className="metaLine" style={{ marginBottom: 10, opacity: 0.95 }}>
                <span>⚠️ {aulasError.split("\n")[0]}</span>
              </div>
            ) : null}

            <div className="todayList">
              {!loadingClasses && academicEvents.length > 0 && academicEvents.some((t) => /feriado|suspensi|receso|vacaci|pausa|asºeto|asueto/i.test(t)) && (
                <div className="classItem" style={{ borderStyle: "dashed", opacity: 0.95 }}>
                  <div className="timeCol">—</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 950 }}>📅 Hoy no hay clases</div>
                    <div className="metaLine"><span>{academicEvents.join(" • ")}</span></div>
                  </div>
                </div>
              )}
              {academicEvents.length > 0 && !academicEvents.some((t) => /feriado|suspensi|receso|vacaci|pausa|asºeto|asueto/i.test(t)) && (
                <div className="classItem" style={{ opacity: 0.9 }}>
                  <div className="timeCol">📅</div>
                  <div className="metaLine"><span><strong>Calendario académico:</strong> {academicEvents.join(" • ")}</span></div>
                </div>
              )}
              {!loadingClasses && classesForDay.length === 0 && academicEvents.length === 0 && (
                <div className="classItem" style={{ borderStyle: "dashed", opacity: 0.95 }}>
                  <div className="timeCol">—</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 950 }}>📅 Día libre</div>
                    <div className="metaLine"><span>Sin clases</span></div>
                  </div>
                </div>
              )}
              {classesForDay.map((c, idx) => {
                const key = `${c.horaInicio}|${c.horaFin}|${c.materia}|${c.tipo}-${c.seccion}`;
                const info = aulasInfo[key];
                const aula = aulasOn ? (info?.found ? info.aula : "—") : "—";
                const estado = aulasOn ? (info?.found ? info.estado : { icon: "ℹ️ ", text: "Sin coincidencia", code: "NC" }) : null;
                return (
                  <div className="classItem" key={idx}>
                    <div className="timeCol">{c.horaInicio} - {c.horaFin}</div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 950 }}>{c.materia} <span className="muted">({c.tipo}-{c.seccion})</span></div>
                      <div className="metaLine">
                        <span>👤 {c.profesor || "—"}</span>
                        {estado?.text ? (
                          <span className={estado.icon === "✅" ? "badgeOk" : estado.icon === "❌" ? "badgeBad" : "badgeWarn"}>
                            {estado.icon} {estado.text}
                          </span>
                        ) : null}
                      </div>
                      <div className="metaLine">
                        <span> 📅 Aula: <span className="mono">{aula}</span></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ===============================================
            AVISOS
        ================================================ */}
        <div className="blockAvisos">
          <Card className="fullWidth" title={<span className="sectionLabel">📅 AVISOS</span>}>
            <div className="avisosBox">
              (Espacio reservado para avisos / recordatorios)
            </div>
          </Card>
        </div>

        <div className="blockLinks footerLinks fullWidth linksBox">🔗 Enlaces útiles</div>
      </div>
    </div>
  );
}
