export const dynamic = "force-dynamic";

import { getSupabaseServer } from "@/lib/supabaseClient";
import {
  normalizeClassType,
  normalizeSection,
  normalizeSubjectName,
} from "@/lib/academicDataNormalization";

type DiasData = Record<string, { cabeceras: any[]; filas: any[][] }>;

interface RequestedCourse {
  materia: string;
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
  aula?: string;
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

function normTimeLoose(s?: string): string {
  const raw = String(s || "").trim();
  if (!raw) return "";

  // 7:30 / 7.30 / 7;30 / 7 30 / 11:39:20
  let m = raw.match(/^(\d{1,2})\s*[:.;,\s]\s*(\d{2})(?::\d{2})?$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // 730 / 929 / 1050
  if (/^\d{3,4}$/.test(raw)) {
    const h = raw.slice(0, -2);
    const m2 = raw.slice(-2);
    const hh = Number(h);
    const mm = Number(m2);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // decimal tipo Sheets
  const num = Number(raw);
  if (!Number.isNaN(num) && num >= 0 && num < 1) {
    const totalMinutes = Math.round(num * 24 * 60);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  return raw;
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

function prettifyDay(dayKey: string): string {
  const t = String(dayKey || "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function pickColIndexes(cabeceras: any[]) {
  const h = cabeceras.map((x) => normalizeText(String(x || "")));

  const findExactOrIncludes = (...keys: string[]) => {
    for (const k of keys) {
      const exactIdx = h.findIndex((x) => x === k);
      if (exactIdx !== -1) return exactIdx;
    }
    for (const k of keys) {
      const idx = h.findIndex((x) => x.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    semestre: findExactOrIncludes("SEMESTRE", "SEMESTR"),
    materia: findExactOrIncludes("ASIGNATURA", "MATERIA"),
    seccion: findExactOrIncludes("SECCION", "SECCIÓN", "SECC"),
    tipo: findExactOrIncludes("TIPO DE CLASE", "TIPO"),
    docente: findExactOrIncludes("DOCENTE", "PROF"),
    horaInicio: findExactOrIncludes("HORA INICIO"),
    horaFin: findExactOrIncludes("HORA FIN"),
    aula: findExactOrIncludes("AULA"),
  };
}

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("aulas_cache")
      .select("dias")
      .single();

    if (error || !data?.dias) {
      return Response.json({ ok: false, error: "Sin datos de aulas en cache" }, { status: 503 });
    }

    const materiasUnicas = new Map<string, string>();

    for (const dayData of Object.values(data.dias as DiasData)) {
      if (!dayData?.filas?.length) continue;

      const cols = pickColIndexes(dayData.cabeceras || []);
      if (cols.materia < 0) continue;

      for (const row of dayData.filas) {
        const nombreExacto = String(row[cols.materia] || "").trim();
        const clave = normalizeSubjectName(nombreExacto);
        if (clave && !materiasUnicas.has(clave)) {
          materiasUnicas.set(clave, nombreExacto);
        }
      }
    }

    const materias = Array.from(materiasUnicas.values()).sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" })
    );

    return Response.json({ ok: true, materias });
  } catch (e: any) {
    console.error("ERROR listado de materias de aulas:", e);
    return Response.json(
      { ok: false, error: e?.message || "Error" },
      { status: 500 }
    );
  }
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
    const ambiguous: string[] = [];

    console.log("=== DEBUG HORARIO SUGERENCIAS: DIAS DISPONIBLES ===");
    console.log(Object.keys(diasData || {}));

    for (const course of materias) {
      const qMateria = normalizeSubjectName(course.materia);

      const optionsMap = new Map<string, SuggestedClass>();
      const ambiguousKeys = new Set<string>();

      console.log("=== BUSCANDO MATERIA ===", {
        materiaOriginal: course.materia,
        materiaNormalizada: qMateria,
      });

      for (const [dayKey, dayData] of Object.entries(diasData)) {
        if (!dayData?.filas?.length) continue;

        const cols = pickColIndexes(dayData.cabeceras || []);

        console.log("=== DIA / CABECERAS / COLS ===", {
          dayKey,
          cabeceras: dayData.cabeceras,
          cols,
        });

        if (cols.materia < 0 || cols.tipo < 0) continue;

        const dayId = getDayId(normalizeText(dayKey));
        if (!dayId) continue;

        for (const row of dayData.filas) {
          const mat = normalizeSubjectName(row[cols.materia]);
          if (!mat || mat !== qMateria) continue;

          const tipo = normalizeClassType(row[cols.tipo]);
          if (!tipo) continue;

          const seccion = cols.seccion >= 0 ? String(row[cols.seccion] || "").trim() : "";
          const seccionNormalizada = normalizeSection(seccion);

          const inicioRaw = cols.horaInicio >= 0 ? String(row[cols.horaInicio] || "").trim() : "";
          const finRaw = cols.horaFin >= 0 ? String(row[cols.horaFin] || "").trim() : "";

          const inicioNormalizado = normTimeLoose(inicioRaw);
          const finNormalizado = normTimeLoose(finRaw);

          // SOLO para mostrar, no para filtrar
          const inicio = inicioNormalizado || inicioRaw || "—";
          const fin = finNormalizado || finRaw || "—";

          const prof =
            cols.docente >= 0 ? String(row[cols.docente] || "").trim() : "";
          const aula = cols.aula >= 0 ? String(row[cols.aula] || "").trim() : "";

          console.log("=== MATCH ENCONTRADO ===", {
            dayKey,
            materia: course.materia,
            seccion,
            tipo,
            inicioRaw,
            finRaw,
            inicio,
            fin,
            prof,
            row,
          });

          const groupKey = [
            qMateria,
            tipo,
            seccionNormalizada,
            dayId,
            inicio,
            fin,
          ].join("|");

          const candidate: SuggestedClass = {
            tempId: `${dayId}-${tipo}-${seccion || "SINSEC"}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            day_id: dayId,
            dia: prettifyDay(dayKey),
            materia: course.materia,
            tipo,
            seccion,
            inicio,
            fin,
            prof,
            aula,
          };

          const existing = optionsMap.get(groupKey);
          if (ambiguousKeys.has(groupKey)) continue;

          const candidateHasHora = inicio !== "—" && fin !== "—";
          const existingHasHora =
            existing ? existing.inicio !== "—" && existing.fin !== "—" : false;

          if (!existing) {
            optionsMap.set(groupKey, candidate);
          } else if (
            normalizeText(existing.prof || "") !== normalizeText(candidate.prof || "") ||
            normalizeText(existing.aula || "") !== normalizeText(candidate.aula || "")
          ) {
            optionsMap.delete(groupKey);
            ambiguousKeys.add(groupKey);
            ambiguous.push(`${course.materia} — sección ${seccion || "sin sección"} — ${tipo} — ${prettifyDay(dayKey)} ${inicio}`);
          } else if (!existingHasHora && candidateHasHora) {
            optionsMap.set(groupKey, candidate);
          }
        }
      }

      const options = Array.from(optionsMap.values());

      options.sort((a, b) => {
        if (a.day_id !== b.day_id) return a.day_id - b.day_id;
        return String(a.inicio).localeCompare(String(b.inicio));
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
      ambiguous,
    });
  } catch (e: any) {
    console.error("ERROR horario-sugerencias:", e);
    return Response.json(
      { ok: false, error: e?.message || "Error" },
      { status: 500 }
    );
  }
}
