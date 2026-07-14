"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/Card";
import CourseManager, { type CourseRow } from "@/components/CourseManager";
import { useMaintenanceMode } from "@/components/MaintenanceProvider";
import SemesterSetupWizard from "@/components/SemesterSetupWizard";
import { CAREER_OPTIONS, CURRICULUM_OPTIONS } from "@/lib/academicOptions";
import { getSupabase } from "@/lib/supabaseClient";
import { Session } from "@supabase/supabase-js";

/* =========================================================
   TIPOS
========================================================= */
type Profile = {
  alumno: string;
  ci: string;
  carrera: string;
  malla: string;
  ingreso: string;
  intensificacion?: string; // 👈 NUEVO
  user_id?: string;
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
  intensificacion: "", // 👈 NUEVO
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
  plan: string = "2023",
  intensificacion: string = ""
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
      const query =
        carrera === "Ingeniería Electrónica" && plan === "2023"
          ? `/api/malla?carrera=${encodeURIComponent(carrera || "")}&plan=${encodeURIComponent(plan)}&intensificacion=${encodeURIComponent(intensificacion || "")}`
          : `/api/malla?carrera=${encodeURIComponent(carrera || "")}&plan=${encodeURIComponent(plan)}`;

      const r = await fetch(query);
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
   FUNCIONES HELPER PARA TRACKING
========================================================= */
async function trackUserActivity(userId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase
      .from("user_activity")
      .upsert({
        user_id: userId,
        last_seen: new Date().toISOString()
      }, { onConflict: 'user_id' });
  } catch (error) {
    console.error("Error tracking user activity:", error);
  }
}

/* =========================================================
   PAGE PRINCIPAL
========================================================= */
export default function Page() {
  const router = useRouter();
  const maintenance = useMaintenanceMode();

  /* =======================================================
     ESTADOS GENERALES
  ======================================================== */
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [semesterSetupOpen, setSemesterSetupOpen] = useState(false);
  const [semesterSetupMessage, setSemesterSetupMessage] = useState("");

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
     DEBOUNCE REFS
  ======================================================== */
  const refreshAulasTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const computeNotasKpisTimeoutRef = useRef<NodeJS.Timeout | null>(null);


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

        // Track user activity (silencioso, no bloquea UI)
        trackUserActivity(uid).catch(console.error);

        /* --- cargar perfil desde Supabase --- */
        const { data: profileData } = await supabase
          .from("user_profiles")
          .select("alumno, ci, carrera, malla, ingreso, intensificacion, user_id")
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
          .select("id, semestre, materia, firma, tipos")
          .eq("user_id", uid)
          .order("semestre", { ascending: true });

        if (coursesData) {
          const loaded = coursesData.map((c) => ({
            id: c.id,
            semestre: String(c.semestre ?? ""),
            materia: c.materia ?? "",
            firma: c.firma ?? "",
            tipos: Array.isArray(c.tipos) ? c.tipos : [],
          }));
          setCourses(loaded);
        }

        // Set initial loading to false after basic data
        setLoading(false);
        setLoadingCourses(false);
        setIsInitialLoading(false);

        /* --- cargar próximo examen --- */
        const nextExamData = await computeNextExam(uid);
        setNextExam(nextExamData);

        /* --- cargar KPIs de notas --- */
        const kpis = await computeNotasKpis(
          uid,
          profileData?.carrera || "",
          profileData?.malla || DEFAULT_PROFILE.malla,
          profileData?.intensificacion || ""
        );
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
      const kpis = await computeNotasKpis(
        userId,
        profile.carrera,
        profile.malla || DEFAULT_PROFILE.malla,
        profile.intensificacion || ""
      );
      if (!cancelled) setNotasKpis(kpis);
    };

    // Función debounceada para el listener de cambios en tiempo real
    const debouncedRefreshKpis = () => {
      if (computeNotasKpisTimeoutRef.current) {
        clearTimeout(computeNotasKpisTimeoutRef.current);
      }
      computeNotasKpisTimeoutRef.current = setTimeout(() => {
        if (!cancelled) {
          refreshKpis();
        }
      }, 1000); // 1000ms debounce
    };

    refreshKpis(); // Carga inicial (sin debounce)

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
            debouncedRefreshKpis(); // Con debounce para evitar múltiples llamadas
          }
        )
        .subscribe();

      // Also listen for event from notas-finales page for immediate feedback (sin debounce para respuesta inmediata)
      const handleNotasUpdated = (event: Event) => {
        const customEvent = event as CustomEvent;
        if (customEvent.detail?.userId === userId && !cancelled) {
          refreshKpis(); // Llamada directa (sin debounce) para feedback inmediato
        }
      };

      window.addEventListener("notasUpdated", handleNotasUpdated);

      return () => {
        cancelled = true;
        subscription.unsubscribe();
        window.removeEventListener("notasUpdated", handleNotasUpdated);
        // Limpiar timeout pendiente al desmontar
        if (computeNotasKpisTimeoutRef.current) {
          clearTimeout(computeNotasKpisTimeoutRef.current);
          computeNotasKpisTimeoutRef.current = null;
        }
      };
    } catch (error) {
      console.error("Error setting up notes subscription:", error);
      return () => {
        cancelled = true;
        // Limpiar timeout pendiente
        if (computeNotasKpisTimeoutRef.current) {
          clearTimeout(computeNotasKpisTimeoutRef.current);
          computeNotasKpisTimeoutRef.current = null;
        }
      };
    }
  }, [userId, profile.carrera, profile.malla, profile.intensificacion]);

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

    if (
      !profileDraft.alumno ||
      !profileDraft.ci ||
      !profileDraft.carrera ||
      !profileDraft.malla ||
      !profileDraft.ingreso ||
      (
        profileDraft.carrera === "Ingeniería Electrónica" &&
        profileDraft.malla === "2023" &&
        !profileDraft.intensificacion
      )
    ) {
      setToastProfile("❌ Por favor completa todos los campos");
      return;
    }

    setSavingProfile(true);
    setToastProfile("");

    try {
      const supabase = getSupabase();

      const payload = {
        user_id: userId,
        alumno: profileDraft.alumno,
        ci: profileDraft.ci,
        carrera: profileDraft.carrera,
        malla: profileDraft.malla,
        ingreso: profileDraft.ingreso,
        intensificacion:
          profileDraft.carrera === "Ingeniería Electrónica" &&
            profileDraft.malla === "2023"
            ? profileDraft.intensificacion || ""
            : "",
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("user_profiles")
        .update(payload)
        .eq("user_id", userId)
        .select();

      if (error) {
        console.error("Error guardando perfil:", error);
        setToastProfile(`❌ No se pudo guardar el perfil: ${error.message}`);
        return;
      }

      if (!data || data.length === 0) {
        setToastProfile("❌ No se encontró el perfil para actualizar");
        return;
      }

      const perfilActualizado = data[0];

      setProfile({
        alumno: perfilActualizado.alumno || "",
        ci: perfilActualizado.ci || "",
        carrera: perfilActualizado.carrera || "",
        malla: perfilActualizado.malla || "",
        ingreso: perfilActualizado.ingreso || "",
        intensificacion: perfilActualizado.intensificacion || "",
        user_id: perfilActualizado.user_id,
      });

      setProfileDraft({
        alumno: perfilActualizado.alumno || "",
        ci: perfilActualizado.ci || "",
        carrera: perfilActualizado.carrera || "",
        malla: perfilActualizado.malla || "",
        ingreso: perfilActualizado.ingreso || "",
        intensificacion: perfilActualizado.intensificacion || "",
        user_id: perfilActualizado.user_id,
      });

      setProfileEditMode(false);
      setProfileHasData(true);
      setToastProfile("✅ Datos guardados");
      setTimeout(() => setToastProfile(""), 2500);
    } catch (e) {
      console.error("Error inesperado guardando perfil:", e);
      setToastProfile("❌ Error inesperado al guardar");
    } finally {
      setSavingProfile(false);
    }
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
     FUNCIÓN: REFRESCAR AULAS CON DEBOUNCE (para cambios en tiempo real)
  ======================================================== */
  const debouncedRefreshAulas = () => {
    if (refreshAulasTimeoutRef.current) {
      clearTimeout(refreshAulasTimeoutRef.current);
    }
    refreshAulasTimeoutRef.current = setTimeout(() => {
      refreshAulas();
    }, 1000); // 1000ms debounce
  };

  /* =======================================================
     EFECTO: SUSCRIPCIÓN EN TIEMPO REAL DE AULAS
  ======================================================== */
  useEffect(() => {
    if (userId && classesForDay.length > 0 && testDateISO) {
      refreshAulas(); // Carga inicial (sin debounce)

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
            debouncedRefreshAulas(); // Con debounce para evitar múltiples llamadas
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
        // Limpiar timeout pendiente al desmontar
        if (refreshAulasTimeoutRef.current) {
          clearTimeout(refreshAulasTimeoutRef.current);
          refreshAulasTimeoutRef.current = null;
        }
      };
    }
  }, [userId, classesForDay.length, testDateISO]);
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
            className="profileCard"
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
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        marginTop: "4px",
                        minWidth: "100px",
                        boxShadow: "0 4px 6px rgba(0,0,0,0.08)",
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
                    setProfileDraft((p) => ({
                      ...p,
                      carrera: e.target.value,
                      intensificacion:
                        e.target.value === "Ingeniería Electrónica" && p.malla === "2023"
                          ? p.intensificacion || ""
                          : "",
                    }))
                  }
                  disabled={!profileEditMode}
                >
                  <option value="">Selecciona tu carrera</option>
                  {CAREER_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="muted">▼</span>
              </div>
            </div>
            {profileDraft.carrera === "Ingeniería Electrónica" && profileDraft.malla === "2023" && (
              <div className="smallRow">
                <div className="smallKey">Intensificación:</div>
                <div className="fakeInput fakeSelect">
                  <select
                    className="profileSelect"
                    value={profileDraft.intensificacion || ""}
                    onChange={(e) =>
                      setProfileDraft((p) => ({
                        ...p,
                        intensificacion: e.target.value,
                      }))
                    }
                    disabled={!profileEditMode}
                  >
                    <option value="">Selecciona tu intensificación</option>
                    <option value="SPyC">SPyC</option>
                    <option value="CiC">CiC</option>
                    <option value="TICs">TICs</option>
                    <option value="BiO">BiO</option>
                  </select>
                  <span className="muted">▼</span>
                </div>
              </div>
            )}

            <div className="smallRow">
              <div className="smallKey">Malla:</div>
              <div className="fakeInput fakeSelect">
                <select
                  className="profileSelect"
                  value={profileDraft.malla}
                  onChange={(e) =>
                    setProfileDraft((p) => ({
                      ...p,
                      malla: e.target.value,
                      intensificacion:
                        p.carrera === "Ingeniería Electrónica" && e.target.value === "2023"
                          ? p.intensificacion || ""
                          : "",
                    }))
                  }
                  disabled={!profileEditMode}
                >
                  <option value="">Selecciona la malla</option>
                  {CURRICULUM_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
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

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "grid", gap: 8 }}>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => {
                  if (maintenance.isRestricted) {
                    setSemesterSetupMessage(maintenance.actionMessage);
                    return;
                  }
                  setSemesterSetupOpen(true);
                }}
                disabled={maintenance.isRestricted}
                title={maintenance.isRestricted ? maintenance.disabledMessage : undefined}
                style={{ width: "100%", opacity: maintenance.isRestricted ? 0.58 : 1 }}
              >
                Configurar nuevo ciclo
              </button>
              {semesterSetupMessage && (
                <div role="status" style={{ color: "var(--primary)", fontWeight: 800, fontSize: 12 }}>
                  {semesterSetupMessage}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ===============================================
            CLASES DE HOY
        ================================================ */}
        <div className="blockClases" id="clases-hoy">
          <Card
            title={<span className="sectionLabel">📅 CLASES DE HOY</span>}
          >
            {(() => {
              const currentDate = new Date(`${testDateISO}T00:00:00`);
              const isDomingo = currentDate.getDay() === 0;

              return (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontStyle: "italic", textAlign: "left", fontWeight: 900 }}>
                      {currentDate.toLocaleDateString("es-PY", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </div>
                  </div>

                  {aulasError && !isDomingo ? (
                    <div className="metaLine" style={{ marginBottom: 10, opacity: 0.95 }}>
                      <span>⚠️ {aulasError.split("\n")[0]}</span>
                    </div>
                  ) : null}

                  <div className="todayList">
                    {isDomingo ? (
                      <div className="classItem" style={{ borderStyle: "dashed", opacity: 0.95 }}>
                        <div className="timeCol">—</div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontWeight: 950 }}>🌿 Domingo - Día libre</div>
                          <div className="metaLine"><span>Sin clases</span></div>
                        </div>
                      </div>
                    ) : (
                      <>
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
                          const observacion = aulasOn ? info?.observacion : null;
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

                                {observacion && (
                                  <div className="metaLine" style={{ color: "var(--danger)", fontWeight: 600 }}>
                                    ⚠️ {observacion}
                                  </div>
                                )}
                                <div className="metaLine">
                                  <span> 📅 Aula: <span className="mono">{aula}</span></span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </>
              );
            })()}
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
                <div style={{ fontWeight: 900, color: "var(--text)" }}>Aprobadas</div>
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
                ? (
                  nextExam.horasRestantes !== undefined
                    ? `${nextExam.horasRestantes} ${nextExam.horasRestantes === 1 ? "hora" : "horas"}`
                    : `${nextExam.dias} ${nextExam.dias === 1 ? "día" : "días"}`
                )
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
          <CourseManager
            mode="persisted"
            userId={userId}
            initialCourses={courses}
            loading={loadingCourses}
            onCoursesChange={setCourses}
            onScheduleSaved={async () => {
              if (!userId) return;
              const dayId = dayIdFromISO(testDateISO);
              const updatedClasses = await loadScheduleForDay(userId, dayId);
              updatedClasses.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
              setClassesForDay(updatedClasses);
            }}
          />
        </div>
      </div>

      <SemesterSetupWizard
        open={semesterSetupOpen}
        mode="new-cycle"
        initialCareer={profile.carrera}
        initialCurriculum={profile.malla}
        onClose={() => setSemesterSetupOpen(false)}
        onComplete={() => {
          setSemesterSetupOpen(false);
          setSemesterSetupMessage("Flujo validado. El guardado definitivo se conectará en una fase posterior.");
          window.setTimeout(() => setSemesterSetupMessage(""), 4500);
        }}
      />
    </div>
  );
}
