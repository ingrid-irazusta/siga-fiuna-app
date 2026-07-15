import { buildCyclePersistencePayload, type CycleClassInput, type CycleCourseInput } from "@/lib/cyclePersistence";
import { getSupabase } from "@/lib/supabaseClient";

export type ConfigureNewCycleInput = {
  career: string;
  curriculum: string;
  courses: readonly CycleCourseInput[];
  schedule: readonly CycleClassInput[];
  updateCareer: boolean;
  updateCurriculum: boolean;
};

export type ConfigureNewCycleResult = {
  ok: true;
  user_id: string;
  carrera: string;
  malla: string;
  profile_updated: boolean;
  deleted: {
    student_courses: number;
    student_classes: number;
    student_processes: number;
    student_exams: number;
  };
  inserted: {
    student_courses: number;
    student_classes: number;
  };
};

const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function validateInput(input: ConfigureNewCycleInput) {
  const career = input.career.trim();
  const curriculum = input.curriculum.trim();
  const { p_courses, p_classes } = buildCyclePersistencePayload(input.courses, input.schedule);

  if (!career) throw new Error("Selecciona una carrera válida.");
  if (!curriculum) throw new Error("Selecciona una malla válida.");
  if (!p_courses.length) throw new Error("Debes seleccionar al menos una materia.");
  if (!p_classes.length) throw new Error("Debes seleccionar las clases del nuevo ciclo.");

  const courseNames = new Set<string>();
  for (const course of p_courses) {
    if (!course.materia) throw new Error("Una de las materias no tiene un nombre válido.");
    const key = course.materia.toLocaleLowerCase("es");
    if (courseNames.has(key)) throw new Error("La lista contiene materias duplicadas.");
    courseNames.add(key);
  }

  const scheduledCourses = new Set<string>();
  for (const classItem of p_classes) {
    if (!Number.isInteger(classItem.day_id) || classItem.day_id < 1 || classItem.day_id > 6) {
      throw new Error("El horario contiene un día inválido.");
    }
    if (!classItem.materia || !courseNames.has(classItem.materia.toLocaleLowerCase("es"))) {
      throw new Error("El horario contiene una materia no seleccionada.");
    }
    if (!["T", "P", "LAB"].includes(classItem.tipo)) {
      throw new Error("El horario contiene un tipo de clase inválido.");
    }
    if (!TIME_PATTERN.test(classItem.inicio) || !TIME_PATTERN.test(classItem.fin)) {
      throw new Error("El horario contiene una hora inválida.");
    }
    scheduledCourses.add(classItem.materia.toLocaleLowerCase("es"));
  }

  if ([...courseNames].some((courseName) => !scheduledCourses.has(courseName))) {
    throw new Error("Todas las materias deben tener al menos una clase seleccionada.");
  }

  return { career, curriculum, p_courses, p_classes };
}

function publicRpcError(error: { code?: string; message?: string }): string {
  const code = String(error.code || "");
  const message = String(error.message || "");
  const normalized = message.toLocaleLowerCase("es");

  if (code === "PGRST202" || normalized.includes("configure_new_cycle") && normalized.includes("not find")) {
    return "La función para configurar el ciclo todavía no está disponible.";
  }
  if (code === "42501" || normalized.includes("permission denied") || normalized.includes("row-level security")) {
    return "No tienes permisos para configurar el nuevo ciclo.";
  }
  if (code === "28000" || normalized.includes("iniciar sesión") || normalized.includes("jwt")) {
    return "Tu sesión venció. Inicia sesión nuevamente.";
  }

  const allowedMessages = [
    "lista de materias",
    "seleccionar al menos una materia",
    "lista de clases",
    "seleccionar al menos una clase",
    "materias tienen datos inválidos",
    "tipos de clase",
    "materias duplicadas",
    "clases tienen datos inválidos",
    "materia no seleccionada",
    "al menos una clase seleccionada",
    "clases duplicadas",
    "carrera seleccionada",
    "malla seleccionada",
    "cambio de carrera",
    "cambio de malla",
  ];
  if (allowedMessages.some((fragment) => normalized.includes(fragment))) return message;

  return "No se pudo configurar el nuevo ciclo. Intenta nuevamente.";
}

function isResult(value: unknown): value is ConfigureNewCycleResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ConfigureNewCycleResult>;
  return result.ok === true && Boolean(result.deleted) && Boolean(result.inserted);
}

export async function configureNewCycle(input: ConfigureNewCycleInput): Promise<ConfigureNewCycleResult> {
  const normalized = validateInput(input);
  const supabase = getSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    throw new Error("Tu sesión venció. Inicia sesión nuevamente.");
  }

  const { data, error } = await supabase.rpc("configure_new_cycle", {
    p_courses: normalized.p_courses,
    p_classes: normalized.p_classes,
    p_carrera: normalized.career,
    p_malla: normalized.curriculum,
    p_update_carrera: Boolean(input.updateCareer),
    p_update_malla: Boolean(input.updateCurriculum),
  });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("configure_new_cycle RPC error", error);
    }
    throw new Error(publicRpcError(error));
  }

  if (!isResult(data)) {
    if (process.env.NODE_ENV === "development") {
      console.error("configure_new_cycle returned an invalid response", data);
    }
    throw new Error("La configuración terminó con una respuesta inválida.");
  }

  return data;
}
