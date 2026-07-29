export const dynamic = "force-dynamic";
import { createHash } from "node:crypto";
import { getSupabaseServer } from "@/lib/supabaseClient";
import {
  normalizeClassType,
  normalizeScheduleTime,
  normalizeSection,
  normalizeSubjectName,
  normalizeTextForMatching,
  normalizeWhitespace,
} from "@/lib/academicDataNormalization";

function normalizeHora(hora: any): string {
  if (hora === null || hora === undefined) return "";

  const str = String(hora).trim();
  if (!str) return "";

  // 7:30 / 7.30 / 7;30 / 7 30 / 11:39:20
  let m = str.match(/^(\d{1,2})\s*[:.;,\s]\s*(\d{2})(?::\d{2})?$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // 929 / 1050 / 730
  if (/^\d{3,4}$/.test(str)) {
    const h = str.slice(0, -2);
    const m2 = str.slice(-2);
    const hh = Number(h);
    const mm = Number(m2);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // número decimal tipo Sheets
  const num = Number(str);
  if (!Number.isNaN(num) && num >= 0 && num < 1) {
    const totalMinutes = Math.round(num * 24 * 60);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  return "";
}
function normalizeHeader(s?: any): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers: any[], ...keys: string[]): number {
  const normalizedHeaders = headers.map((header) => normalizeTextForMatching(header));
  for (const key of keys.map((value) => normalizeTextForMatching(value))) {
    const exact = normalizedHeaders.findIndex((header) => header === key);
    if (exact >= 0) return exact;
  }
  for (const key of keys.map((value) => normalizeTextForMatching(value))) {
    const included = normalizedHeaders.findIndex((header) => header.includes(key));
    if (included >= 0) return included;
  }
  return -1;
}

function cell(row: any[], index: number): unknown {
  return index >= 0 ? row[index] : "";
}

function hashSignatures(signatures: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...signatures].sort()))
    .digest("hex");
}

function buildDistributionVersions(dias: Record<string, any>) {
  const academicSignatures: string[] = [];
  const temporarySignatures: string[] = [];

  for (const [day, data] of Object.entries(dias)) {
    if (day === "_meta") continue;
    const headers = Array.isArray(data?.cabeceras) ? data.cabeceras : [];
    const rows = Array.isArray(data?.filas) ? data.filas : [];
    const columns = {
      subject: findColumn(headers, "ASIGNATURA", "MATERIA"),
      section: findColumn(headers, "SECCION", "SECCIÓN", "SECC"),
      type: findColumn(headers, "TIPO DE CLASE", "TIPO"),
      professor: findColumn(headers, "DOCENTE", "PROF"),
      start: findColumn(headers, "HORA INICIO", "INICIO"),
      end: findColumn(headers, "HORA FIN", "FIN"),
      room: findColumn(headers, "AULA"),
      status: findColumn(headers, "ESTADO", "P - R", "P-R"),
      observation: findColumn(headers, "OBSERVACION", "OBS"),
      replacement: findColumn(headers, "REEMPLAZO", "SUPL"),
    };

    for (const rawRow of rows) {
      const row = Array.isArray(rawRow) ? rawRow : [];
      const subject = normalizeSubjectName(cell(row, columns.subject));
      if (!subject) continue;
      const rawType = cell(row, columns.type);
      const academicIdentity = {
        day: normalizeTextForMatching(day),
        subject,
        section: normalizeSection(cell(row, columns.section)),
        type: normalizeClassType(rawType) || normalizeTextForMatching(rawType),
        start: normalizeScheduleTime(cell(row, columns.start)) || normalizeWhitespace(cell(row, columns.start)),
        end: normalizeScheduleTime(cell(row, columns.end)) || normalizeWhitespace(cell(row, columns.end)),
        professor: normalizeTextForMatching(cell(row, columns.professor)),
        room: normalizeTextForMatching(cell(row, columns.room)),
      };
      academicSignatures.push(JSON.stringify(academicIdentity));
      temporarySignatures.push(JSON.stringify({
        ...academicIdentity,
        status: normalizeTextForMatching(cell(row, columns.status)),
        observation: normalizeWhitespace(cell(row, columns.observation)),
        replacement: normalizeTextForMatching(cell(row, columns.replacement)),
      }));
    }
  }

  return {
    academicVersion: hashSignatures(academicSignatures),
    temporaryVersion: hashSignatures(temporarySignatures),
  };
}

const SECRET = process.env.AULAS_SYNC_SECRET || "";

export async function POST(req: Request) {
  try {
    // Verificación básica para que no cualquiera pueda escribir
    const authHeader = req.headers.get("x-secret") || "";
    if (SECRET && authHeader !== SECRET) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    if (!body?.dias || typeof body.dias !== "object") {
      return Response.json({ ok: false, error: "Faltan datos" }, { status: 400 });
    }

    // DEBUG: log what we received
    console.log('/api/aulas-sync: method=', req.method);
    try {
      console.log("/api/aulas-sync recibio dias keys:", Object.keys(body.dias));
    } catch (e) {
      console.log("/api/aulas-sync: no se pudo leer keys de body.dias");
    }
    try {
      console.log('/api/aulas-sync: x-secret header=', req.headers.get('x-secret'));
    } catch (e) {
      // ignore
    }

    const diasNormalizados = Object.fromEntries(
      Object.entries(body.dias).map(([dia, data]: [string, any]) => {
        const cabeceras = Array.isArray(data?.cabeceras) ? data.cabeceras : [];
        const filas = Array.isArray(data?.filas) ? data.filas : [];

        const idxHoraInicio = cabeceras.findIndex((h: any) =>
          normalizeHeader(h).includes("HORA INICIO")
        );

        const idxHoraFin = cabeceras.findIndex((h: any) =>
          normalizeHeader(h).includes("HORA FIN")
        );

        const filasNormalizadas = filas.map((row: any[]) => {
          const nueva = Array.isArray(row) ? [...row] : [];

          if (idxHoraInicio >= 0) {
            nueva[idxHoraInicio] = normalizeHora(nueva[idxHoraInicio]);
          }

          if (idxHoraFin >= 0) {
            nueva[idxHoraFin] = normalizeHora(nueva[idxHoraFin]);
          }

          return nueva;
        });

        return [
          dia,
          {
            ...data,
            cabeceras,
            filas: filasNormalizadas,
          },
        ];
      })
    );
    const versions = buildDistributionVersions(diasNormalizados);
    const diasConVersiones = {
      ...diasNormalizados,
      _meta: versions,
    };
    console.log("=== DIAS NORMALIZADOS SAMPLE ===");
    for (const [dia, data] of Object.entries(diasNormalizados)) {
      const filas = Array.isArray((data as any)?.filas) ? (data as any).filas : [];
      console.log(dia, filas.slice(0, 5));
    }
    const supabase = getSupabaseServer();
    const res = await supabase
      .from("aulas_cache")
      .upsert({ id: 1, dias: diasConVersiones, updated_at: new Date().toISOString() });

    if (res.error) {
      console.error("Supabase upsert error:", res.error);
      return Response.json({ ok: false, error: res.error.message || "Supabase error" }, { status: 500 });
    }

    console.log("/api/aulas-sync: upsert OK");
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}
