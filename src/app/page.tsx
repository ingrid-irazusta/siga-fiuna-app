"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/Card";
import { getSupabase } from "@/lib/supabaseClient";
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
  carrera: "",
  malla: "",
  ingreso: "",
};

/* =========================================================
   FUNCIONES HELPER
========================================================= */
function stripDiacritics(s?: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function romanToArabicTokens(s: string): string {
  const map: Record<string, string> = {
    "X": "10", "IX": "9", "VIII": "8", "VII": "7",
    "VI": "6", "V": "5", "IV": "4", "III": "3",
    "II": "2", "I": "1",
  };
  return s.replace(/\b(X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (m) => map[m] || m);
}

function normText(s: string): string {
  return romanToArabicTokens(stripDiacritics(String(s)))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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
  carrera: string,
  plan: string = "2023"
): Promise<{ promedioStr: string; aprobadas: number; total: number; progresoPct: number; faltan: number }> {
  try {
    const supabase = getSupabase();
    const { data: notes } = await supabase
      .from("student_notes")
      .select("materia, nota1, nota2, nota3")
      .eq("user_id", userId);

    // Obtener la lista completa de materias desde la BD de malla (API interna)
    let materiasMallaSet = new Set<string>();
    try {
      const r = await fetch(
        `/api/malla?carrera=${encodeURIComponent(carrera || "")}&plan=${encodeURIComponent(plan)}`
      );
      const mdata = await r.json().catch(() => null);
      if (r.ok && mdata?.ok && Array.isArray(mdata.materias)) {
        for (const m of mdata.materias) {
          const semestre = Number(m?.semestre) || 0;
          if (semestre <= 0) continue; // contar sólo materias con semestre válido
          const nombre = String(m?.materia || "");
          const k = normText(nombre);
          if (k) materiasMallaSet.add(k);
        }
      }
    } catch {
      // ignore, fallback below
    }

    // Fallback: si no se pudo obtener la malla, usar las materias que el usuario tiene en student_courses
    if (materiasMallaSet.size === 0) {
      const { data: courses } = await supabase
        .from("student_courses")
        .select("materia")
        .eq("user_id", userId);
      for (const c of courses || []) materiasMallaSet.add(normText(c.materia || ""));
    }

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

    // Contar aprobadas sobre la malla completa (no solo las materias que el usuario agregó)
    const aprobadas = Array.from(materiasMallaSet).reduce(
      (acc, k) => acc + (aprobadaByMateria.get(k) ? 1 : 0),
      0
    );

    const total = materiasMallaSet.size || 0;
    const progresoPct = total ? (aprobadas / total) * 100 : 0;
    const faltan = Math.max(0, total - aprobadas);

    return {
      promedioStr: promedioNum ? promedioNum.toFixed(2).replace(".", ",") : "0,00",
      aprobadas,
      total,
      progresoPct,
      faltan,
    };
  } catch (e) {
    console.error("computeNotasKpis error:", e);
    return { promedioStr: "0,00", aprobadas: 0, total: 0, progresoPct: 0, faltan: 0 };
  }
}

async function computeNextExam(userId: string): Promise<{
  materia: string;
  tipo: string;
  fecha: string;
  hora: string;
  dias: number;
  horasRestantes?: number;
} | null> {
  try {
    const supabase = getSupabase();
    const { data: exams } = await supabase
      .from("student_exams")
      .select("materia, tipo, fecha, hora")
      .eq("user_id", userId);

    if (!exams || exams.length === 0) return null;

    const now = new Date();

    // Obtener todos los exámenes futuros o de hoy que aún no pasaron
    const futureExams: any[] = [];
    for (const exam of exams) {
      const dt = parseDateTime(exam.fecha, exam.hora);
      if (!dt) continue;

      const dias = daysDiffFromToday(dt);

      // Si ya pasó (días negativos), saltar
      if (dias < 0) continue;

      // Si es hoy, verificar que la hora no haya pasado
      if (dias === 0) {
        const examTime = dt.getTime();
        const currentTime = now.getTime();
        if (examTime <= currentTime) continue; // Ya pasó, saltar
      }

      futureExams.push({
        materia: exam.materia,
        tipo: exam.tipo,
        fecha: exam.fecha,
        hora: exam.hora,
        dt,
        dias
      });
    }

    if (futureExams.length === 0) return null;

    // Ordenar por fecha/hora ascendente (el más cercano primero)
    futureExams.sort((a, b) => a.dt.getTime() - b.dt.getTime());

    // Tomar el más cercano
    const nextExam = futureExams[0];

    // Si es hoy, calcular horas restantes
    let horasRestantes: number | undefined;
    if (nextExam.dias === 0) {
      const diffMs = nextExam.dt.getTime() - now.getTime();
      horasRestantes = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60))); // Convertir a horas y redondear hacia arriba
    }

    return {
      materia: nextExam.materia,
      tipo: nextExam.tipo,
      fecha: formatDMY(nextExam.fecha),
      hora: nextExam.hora || "—",
      dias: nextExam.dias,
      horasRestantes,
    };
  } catch {
    return null;
  }
}

async function loadAcademicEvents(date: string): Promise<string[]> {
  try {
    const supabase = getSupabase();
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
    const supabase = getSupabase();
    const { data: classes } = await supabase
      .from("student_classes")
      .select("id, day_id, materia, tipo, seccion, inicio, fin, prof")
      .eq("user_id", userId)
      .eq("day_id", dayId);

    return (classes || []).map(c => ({
      id: c.id,
      dia: c.day_id,
      materia: c.materia,
      tipo: c.tipo,
      seccion: c.seccion,
      horaInicio: c.inicio,
      horaFin: c.fin,
      profesor: c.prof,
    })) as ClassRow[];
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
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  /* =======================================================
     ESTADOS PERFIL
  ======================================================== */
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [profileDraft, setProfileDraft] = useState<Profile>(DEFAULT_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);
  const [toastProfile, setToastProfile] = useState("");
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [profileHasData, setProfileHasData] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  /* =======================================================
     ESTADOS MATERIAS
  ======================================================== */
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [toastCourses, setToastCourses] = useState("");

  /* =======================================================
     ESTADOS EXAMENES Y NOTAS
  ======================================================== */
  const [nextExam, setNextExam] = useState<{
    materia: string;
    tipo: string;
    fecha: string;
    hora: string;
    dias: number;
    horasRestantes?: number;
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
    // Elimina el estado del botón
    const [aulasCountdown, setAulasCountdown] = useState(30);

  
  /* =======================================================
     EFECTO: AUTENTICACIÃ“N + CARGA PERFIL + EXÃMENES + NOTAS
  ======================================================== */
  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.getSession();

        if (error || !data.session) {
          if (error) console.error("Auth error:", error);
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
          setProfileHasData(true);
          setProfileEditMode(false);
        } else {
          setProfileHasData(false);
          setProfileEditMode(true);
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

        // Set initial loading to false after basic data
        setLoading(false);
        setLoadingCourses(false);
        setIsInitialLoading(false);

        /* --- cargar próximo examen --- */
        const nextExamData = await computeNextExam(uid);
        setNextExam(nextExamData);

        /* --- cargar KPIs de notas --- */
        const kpis = await computeNotasKpis(uid, profileData?.carrera || "", profileData?.malla || DEFAULT_PROFILE.malla);
        setNotasKpis(kpis);

      } catch (err) {
        console.error("Error loading data:", err);
        router.push("/auth");
      }
    };

    load();

    return () => {
      // Cleanup will be handled by separate useEffect
    };
  }, [router]);

  /* =======================================================
     EFECTO: LISTENER DE AUTENTICACIÓN
  ======================================================== */
  useEffect(() => {
    const { data: authListener } = getSupabase().auth.onAuthStateChange(
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
    const supabase = getSupabase();
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
      classes.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
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

    let cancelled = false;

    const refreshKpis = async () => {
      const kpis = await computeNotasKpis(userId, profile.carrera, profile.malla || DEFAULT_PROFILE.malla);
      if (!cancelled) setNotasKpis(kpis);
    };

    refreshKpis();

    // Subscribe to real-time changes in student_notes
    try {
      const supabase = getSupabase();
      const subscription = supabase
        .channel(`student_notes_${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "student_notes",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            if (!cancelled) {
              refreshKpis();
            }
          }
        )
        .subscribe();

      // Also listen for event from notas-finales page for immediate feedback
      const handleNotasUpdated = (event: Event) => {
        const customEvent = event as CustomEvent;
        if (customEvent.detail?.userId === userId && !cancelled) {
          refreshKpis();
        }
      };

      window.addEventListener("notasUpdated", handleNotasUpdated);

      return () => {
        cancelled = true;
        subscription.unsubscribe();
        window.removeEventListener("notasUpdated", handleNotasUpdated);
      };
    } catch (error) {
      console.error("Error setting up notes subscription:", error);
      return () => {
        cancelled = true;
      };
    }
  }, [userId, profile.carrera]);

  /* =======================================================
     EFECTO: REFRESCAR PRÓXIMO EXAMEN CUANDO CAMBIEN EXÁMENES EN BD
  ======================================================== */
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
        () => {
          computeNextExam(userId).then(setNextExam);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  /* =======================================================
     FUNCIONES PERFIL
  ======================================================== */
  const onGuardarPerfil = async () => {
    if (!userId) return;

    // Validación de campos obligatorios
    if (!profileDraft.alumno || !profileDraft.ci || !profileDraft.carrera || !profileDraft.malla || !profileDraft.ingreso) {
      setToastProfile("❌ Por favor completa todos los campos");
      return;
    }

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

const supabase = getSupabase();
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
      setProfileEditMode(false);
      setProfileHasData(true);
      setToastProfile("✅ Datos guardados");
      setTimeout(() => setToastProfile(""), 2500);
    }

    setSavingProfile(false);
  };

  /* =======================================================
     FUNCIÓN: REFRESCAR AULAS (ahora para polling)
  ======================================================== */
  const refreshAulas = async () => {
    const startedAt = Date.now();
    try {
      setAulasError("");
      setAulasLoading(true);
      if (classesForDay.length === 0) {
        const msg = "Hoy no hay clases cargadas en tu Horario, por eso no se consultan aulas.";
        setAulasError(msg);
        return;
      }
      const payload = {
        fecha: testDateISO, // ya la tenés como estado
        classes: classesForDay.map((c) => ({
          key: `${c.horaInicio}|${c.horaFin}|${normText(c.materia)}|${c.tipo}-${c.seccion}|${normText(c.profesor || "")}`,
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
        return;
      }
      if (data?.results && typeof data.results === "object") {
        setAulasInfo(data.results);
        console.log("aulasInfo:", data.results);
      }
      setAulasOn(true);
    } catch (e) {
      const msg = `No se pudo conectar a la BD de aulas.\nDebug: ${e instanceof Error ? e.message : "Error"}`;
      setAulasError(msg);
      console.error(e);
    } finally {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 3000 - elapsed);
      if (wait) await new Promise((res) => setTimeout(res, wait));
      setAulasLoading(false);
    }
  };
  /* =======================================================
     EFECTO: SUSCRIPCIÓN EN TIEMPO REAL DE AULAS
  ======================================================== */
  useEffect(() => {
    if(userId && classesForDay.length > 0 && testDateISO) {
      refreshAulas(); // Carga inicial

      // Suscripción a cambios en tiempo real
      const supabase = getSupabase();
      const subscription = supabase
        .channel('aulas_cache_realtime')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'aulas_cache',
          },
          () => {
            refreshAulas();
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [userId, classesForDay.length, testDateISO]);
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
    const supabase = getSupabase();
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
  if (isInitialLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontSize: '18px',
        fontWeight: '600'
      }}>
        <div style={{ marginBottom: '20px' }}>🔄</div>
        <div>Cargando SIGA FIUNA...</div>
        <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '10px' }}>
          Preparando tu dashboard académico
        </div>
      </div>
    );
  }

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
              profileHasData && !profileEditMode && (
                <div style={{ position: "relative" }}>
                  <button
                    className="btn"
                    onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                    style={{ padding: "8px 10px", fontSize: "18px", fontWeight: "bold" }}
                  >
                    {profileMenuOpen ? "✎" : "✎"}
                  </button>
                  {profileMenuOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        background: "white",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        marginTop: "4px",
                        minWidth: "100px",
                        boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                        zIndex: 100,
                      }}
                    >
                      <button
                        className="btn btnPrimary"
                        onClick={() => {
                          setProfileEditMode(true);
                          setProfileMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "10px",
                          fontWeight: "600",
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Editar
                      </button>
                    </div>
                  )}
                </div>
              )
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
                disabled={!profileEditMode}
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
                disabled={!profileEditMode}
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
                  disabled={!profileEditMode}
                >
                  <option value="">Selecciona tu carrera</option>
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
                  disabled={!profileEditMode}
                >
                  <option value="">Selecciona la malla</option>
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
                disabled={!profileEditMode}
              />
            </div>

            {toastProfile && (
              <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                {toastProfile}
              </div>
            )}

            {profileEditMode && (
              <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                <button
                  className="btn btnPrimary"
                  onClick={onGuardarPerfil}
                  disabled={savingProfile}
                  style={{ flex: 1, fontWeight: 950, padding: "10px" }}
                >
                  {savingProfile ? "Guardando…" : "Guardar"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setProfileEditMode(false);
                    setProfileDraft(profile);
                    setToastProfile("");
                  }}
                  disabled={savingProfile}
                  style={{ fontWeight: 950, padding: "10px 16px" }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* ===============================================
            CLASES DE HOY
        ================================================ */}
        <div className="blockClases" id="clases-hoy">
          <Card
            title={<span className="sectionLabel">📅 CLASES DE HOY</span>}
          >
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontStyle: "italic", textAlign: "left", fontWeight: 900 }}>
                {new Date(`${useTestDate ? testDateISO : testDateISO}T00:00:00`).toLocaleDateString("es-PY", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
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
                    <div style={{ fontWeight: 950 }}>🌿 Día libre</div>
                    <div className="metaLine"><span>Sin clases</span></div>
                  </div>
                </div>
              )}
              {classesForDay.map((c, idx) => {
                const key = `${c.horaInicio}|${c.horaFin}|${normText(c.materia)}|${c.tipo}-${c.seccion}|${normText(c.profesor || "")}`;
                const info = aulasInfo[key];
                const aula = aulasOn ? (info?.found ? info.aula : "—") : "—";
                const estado = aulasOn ? (info?.found ? info.estado : { icon: "ℹ️ ", text: "Sin coincidencia", code: "NC" }) : null;
                return (
                  <div className="classItem" key={idx}>
                    <div className="timeCol">{c.horaInicio.slice(0, 5)} - {c.horaFin.slice(0, 5)}</div>
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
        ================================================ 
        <div className="blockAvisos">
          <Card className="fullWidth" title={<span className="sectionLabel">🧭 AVISOS</span>}>
            <div className="avisosBox">
              (Espacio reservado para avisos / recordatorios)
            </div>
          </Card>
        </div>
        */}

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
            PRÓXIMO EXAMEN
        ================================================ */}
        <div className="blockProximo">
          <Card title={<span className="sectionLabel">⏳ PRÓXIMO EXAMEN</span>}>
            <div className="bigDays">
              {nextExam
                ? (nextExam.horasRestantes !== undefined
                    ? `${nextExam.horasRestantes} horas`
                    : `${nextExam.dias} días`)
                : "—"}
            </div>
            <div className="centerNote">
              {nextExam && nextExam.horasRestantes !== undefined ? "Horas Restantes" : "Días Restantes"}
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 950 }}>📌 {nextExam ? nextExam.tipo : "Sin examen"}</div>
              <div style={{ fontWeight: 900 }}>
                {nextExam ? nextExam.materia : "Cargá tus fechas en Evaluaciones"}
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

        <div className="blockLinks footerLinks fullWidth linksBox">🔗 Enlaces útiles</div>
      </div>
    </div>
  );
}
 