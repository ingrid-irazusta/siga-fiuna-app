export type CycleCourseInput = {
  semestre?: string | null;
  materia: string;
  firma?: string | null;
  tipos?: string[] | null;
};

export type CycleClassInput = {
  day_id: number;
  materia: string;
  tipo: string;
  seccion?: string | null;
  inicio: string;
  fin: string;
  prof?: string | null;
};

export type CyclePersistenceCourse = {
  semestre: string | null;
  materia: string;
  firma: string | null;
  tipos: string[];
};

export type CyclePersistenceClass = {
  day_id: number;
  materia: string;
  tipo: string;
  seccion: string | null;
  inicio: string;
  fin: string;
  prof: string | null;
};

export type CyclePersistencePayload = {
  p_courses: CyclePersistenceCourse[];
  p_classes: CyclePersistenceClass[];
};

function trimmedOrNull(value?: string | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function buildCyclePersistencePayload(
  courses: readonly CycleCourseInput[],
  schedule: readonly CycleClassInput[]
): CyclePersistencePayload {
  return {
    p_courses: courses.map((course) => ({
      semestre: trimmedOrNull(course.semestre),
      materia: String(course.materia ?? "").trim(),
      firma: trimmedOrNull(course.firma),
      tipos: Array.isArray(course.tipos)
        ? course.tipos.map((type) => String(type).trim()).filter(Boolean)
        : [],
    })),
    p_classes: schedule.map((classItem) => ({
      day_id: Math.trunc(Number(classItem.day_id)),
      materia: String(classItem.materia ?? "").trim(),
      tipo: String(classItem.tipo ?? "").trim(),
      seccion: trimmedOrNull(classItem.seccion),
      inicio: String(classItem.inicio ?? "").trim(),
      fin: String(classItem.fin ?? "").trim(),
      prof: trimmedOrNull(classItem.prof),
    })),
  };
}
