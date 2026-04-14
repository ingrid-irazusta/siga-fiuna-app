export const dynamic = "force-dynamic";

import { getSupabaseServer } from "@/lib/supabaseClient";

type DiasData = Record<string, { cabeceras: any[]; filas: any[][] }>;

interface RequestedCourse {
  semestre?: string | null;
  materia: string;
  tipos?: string[];
}

interface SuggestedClass {
  tempId: string;
  day_id: number;
  dia: string;
  materia: string;
  tipo: "T" | "P" | "LAB";
  seccion: string;
  inicio: string;
  fin: string;
  prof?: string;
}

interface SuggestionGroup {
  materia: string;
  options: SuggestedClass[];
}

function stripDiacritics(s?: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function romanToArabicTokens(s: string): string {
  const map: Record<string, string> = {
    X: "10",
    IX: "9",
    VIII: "8",
    VII: "7",
    VI: "6",
    V: "5",
    IV: "4",
    III: "3",
    II: "2",
    I: "1",
  };

  return s.replace(/\b(X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (m) => map[m] || m);
}

function normalizeText(s?: string): string {
  return romanToArabicTokens(stripDiacritics(String(s || "")))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTipo(val?: string): "T" | "P" | "LAB" | "" {
  const t = normalizeText(val);
  if (!t) return "";

  if (t === "T" || t.startsWith("TEO") || t.includes("TEORIA")) return "T";
  if (t === "P" || t.startsWith("PRA") || t.includes("PRACT")) return "P";
  if (t === "LAB" || t.startsWith("LAB")) return "LAB";

  return "";
}

function normalizeSemestre(val?: string | null): string {
  return String(val || "")
    .trim()
    .toUpperCase()
    .replace(/º/g, "°")
    .replace(/\s+/g, "");
}

function normTime(s?: string): string {
  const raw = String(s || "").trim();

  // Acepta formatos como 16:00, 16.00, 16;00, 16 00
  const m = raw.match(/(\d{1,2})\s*[:.;,\s]\s*(\d{2})/);
  if (!m) return "";

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (Number.isNaN(hh) || Number.isNaN(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function getDayId(dayKey: string): number {
  const map: Record<string, number> = {
    LUNES: 1,
    MARTES: 2,
    MIERCOLES: 3,
    MIÉRCOLES: 3,
    JUEVES: 4,
    VIERNES: 5,
    SABADO: 6,
    SÁBADO: 6,
  };
  return map[dayKey] || 0;
}

function pickColIndexes(cabeceras: any[]) {
  const h = cabeceras.map((x) => normalizeText(String(x || "")));

  const find = (...keys: string[]) => {
    for (const k of keys) {
      const idx = h.findIndex((x) => x.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    semestre: find("SEMESTRE", "SEMESTR"),
    materia: find("ASIGNATURA", "MATERIA"),
    seccion: find("SECC", "SECCION", "SECCIÓN"),
    tipo: find("TIPO"),
    docente: find("DOCENTE", "PROF"),
    horaInicio: find("HORA INICIO", "INICIO"),
    horaFin: find("HORA FIN", "FIN"),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const materias = Array.isArray(body?.materias) ? (body.materias as RequestedCourse[]) : [];

    if (!materias.length) {
      return Response.json({ ok: false, error: "Sin materias" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("aulas_cache")
      .select("dias")
      .single();

    if (error || !data?.dias) {
      return Response.json({ ok: false, error: "Sin datos de aulas en cache" }, { status: 503 });
    }

    const diasData = data.dias as DiasData;
    const groups: SuggestionGroup[] = [];
    const missing: string[] = [];

    for (const course of materias) {
      const qMateria = normalizeText(course.materia);
      const qSemestre = normalizeSemestre(course.semestre);
      const qTipos = (course.tipos || [])
        .map((t) => normalizeTipo(t))
        .filter(Boolean) as ("T" | "P" | "LAB")[];

      const options: SuggestedClass[] = [];
      const seen = new Set<string>();

      for (const [dayKey, dayData] of Object.entries(diasData)) {
        if (!dayData?.filas?.length) continue;

        const cols = pickColIndexes(dayData.cabeceras || []);
        if (cols.materia < 0 || cols.tipo < 0 || cols.seccion < 0) continue;

        const dayId = getDayId(normalizeText(dayKey));
        if (!dayId) continue;

        for (const row of dayData.filas) {
          const mat = normalizeText(row[cols.materia]);
          if (!mat || mat !== qMateria) continue;

          const sem = cols.semestre >= 0 ? normalizeSemestre(row[cols.semestre]) : "";
          const semestreCoincide = !qSemestre || !sem || sem === qSemestre;
          if (!semestreCoincide) continue;

          const tipo = normalizeTipo(row[cols.tipo]);
          if (!tipo) continue;

          if (qTipos.length > 0 && !qTipos.includes(tipo)) continue;

          const seccion = String(row[cols.seccion] || "").trim();
          const inicio = cols.horaInicio >= 0 ? normTime(row[cols.horaInicio]) : "";
          const fin = cols.horaFin >= 0 ? normTime(row[cols.horaFin]) : "";
          const prof = cols.docente >= 0 ? String(row[cols.docente] || "").trim() : "";

          if (!seccion || !inicio || !fin) continue;

          const dedupeKey = `${course.materia}|${tipo}|${seccion}|${dayId}|${inicio}|${fin}|${prof}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          options.push({
            tempId: `${dayId}-${tipo}-${seccion}-${inicio}-${fin}-${Math.random().toString(36).slice(2, 8)}`,
            day_id: dayId,
            dia: dayKey.charAt(0) + dayKey.slice(1).toLowerCase(),
            materia: course.materia,
            tipo,
            seccion,
            inicio,
            fin,
            prof,
          });
        }
      }

      options.sort((a, b) => {
        if (a.day_id !== b.day_id) return a.day_id - b.day_id;
        return a.inicio.localeCompare(b.inicio);
      });

      if (options.length) {
        groups.push({
          materia: course.materia,
          options,
        });
      } else {
        missing.push(course.materia);
      }
    }

    return Response.json({
      ok: true,
      groups,
      missing,
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "Error" },
      { status: 500 }
    );
  }
}