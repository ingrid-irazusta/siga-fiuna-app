export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabaseClient";
import {
  normalizeClassType,
  normalizeScheduleTime,
  normalizeSection,
  normalizeSubjectName,
} from "@/lib/academicDataNormalization";

type DiasData = Record<string, { cabeceras: any[]; filas: any[][] }>;

let memoriaDias: DiasData | null = null;
let memoriaUpdatedAt: string | null = null;
let memoriaUltimaLectura = 0;

const TTL_MS = 60 * 1000; // 1 minuto

// --- Tipos ---
interface EstadoInfo {
  icon: string;
  text: string;
  code: string;
}

interface MatchResult {
  ok: boolean;
  found: boolean;
  ambiguous?: boolean;
  aula?: string;
  profesor?: string;
  tipo?: "T" | "P" | "LAB";
  inicio?: string;
  fin?: string;
  estado?: EstadoInfo;
  reemplazo?: string;
  observacion?: string;
  error?: string;
}

// --- Helpers ---
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
  return romanToArabicTokens(stripDiacritics(String(s)))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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

function normalizeTipo(val?: string): string {
  return normalizeClassType(val);
}

function decodeEstado(code?: string): EstadoInfo {
  const c = normalizeText(code || "");
  if (!c) return { icon: "⏳", text: "Aún no llegó", code: "" };
  if (c === "P") return { icon: "✅", text: "Presente", code: "P" };
  if (c === "A") return { icon: "❌", text: "Ausente", code: "A" };
  if (c === "AA") return { icon: "⚠️", text: "Ausente c/ Aviso", code: "AA" };
  if (c === "R") return { icon: "🔄", text: "Reemplazo", code: "R" };
  if (c === "T") return { icon: "ℹ️", text: "Tutoría", code: "T" };
  if (c === "REC") return { icon: "📅", text: "Recuperación", code: "REC" };
  return { icon: "ℹ️", text: c, code: c };
}

function minutesFromTime(t: string): number | null {
  const nt = normTime(t);
  if (!nt) return null;

  const [h, m] = nt.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  return h * 60 + m;
}

// --- Detectar índices de columnas desde la fila de cabeceras ---
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
    materia: find("ASIGNATURA", "MATERIA"),
    seccion: find("SECC", "SECCION", "SECCIÓN"),
    tipo: find("TIPO"),
    docente: find("DOCENTE", "PROF"),
    obs: find("OBS", "OBSERV"),
    reemplazo: find("REEMPLAZ", "SUPL"),
    horaInicio: find("HORA INICIO", "INICIO"),
    horaFin: find("HORA FIN", "FIN"),
    aula: find("AULA"),
    estado: find("ESTADO", "P - R", "P-R"),
  };
}

// --- Match para un día específico ---
function matchEnDia(
  diaData: { cabeceras: any[]; filas: any[][] },
  qMateria: string,
  qSeccion: string,
  qTipo: string,
  qHora: string
): MatchResult {
  if (!diaData?.filas?.length) return { ok: true, found: false };

  const cols = pickColIndexes(diaData.cabeceras || []);
  if (cols.materia < 0 || cols.aula < 0) {
    return { ok: false, found: false, error: "Columnas no detectadas" };
  }

  const cands: any[][] = [];

  for (const row of diaData.filas) {
    const mat = normalizeSubjectName(row[cols.materia]);
    const sec = normalizeSection(row[cols.seccion]);
    const tipo = normalizeTipo(String(row[cols.tipo] || ""));

    if (!mat || mat !== qMateria) continue;
    if (sec !== qSeccion) continue;
    if (normalizeTipo(qTipo) !== tipo) continue;

    cands.push(row);
  }

  if (!cands.length) return { ok: true, found: false };

  // Elegir el candidato más cercano en hora
  const qMin = minutesFromTime(qHora);
  const scored = cands.map((row) => {
    const rowMinutes = cols.horaInicio >= 0
      ? minutesFromTime(String(row[cols.horaInicio] || ""))
      : null;
    return {
      row,
      score: qMin === null || rowMinutes === null ? Number.POSITIVE_INFINITY : Math.abs(rowMinutes - qMin),
    };
  });
  const bestScore = Math.min(...scored.map((candidate) => candidate.score));
  const nearest = scored
    .filter((candidate) => candidate.score === bestScore)
    .map((candidate) => candidate.row);
  const uniqueNearest = new Map<string, any[]>();
  for (const row of nearest) {
    const signature = JSON.stringify({
      aula: cols.aula >= 0 ? String(row[cols.aula] || "").trim() : "",
      profesor: cols.docente >= 0 ? String(row[cols.docente] || "").trim() : "",
      inicio: cols.horaInicio >= 0 ? normTime(String(row[cols.horaInicio] || "")) : "",
      fin: cols.horaFin >= 0 ? normTime(String(row[cols.horaFin] || "")) : "",
      tipo: cols.tipo >= 0 ? normalizeTipo(String(row[cols.tipo] || "")) : "",
      estado: cols.estado >= 0 ? String(row[cols.estado] || "").trim() : "",
    });
    if (!uniqueNearest.has(signature)) uniqueNearest.set(signature, row);
  }
  if (uniqueNearest.size !== 1) {
    return { ok: true, found: false, ambiguous: true };
  }
  const best = Array.from(uniqueNearest.values())[0];

  return {
    ok: true,
    found: true,
    aula: String(best[cols.aula] || "").trim() || "No hallada",
    profesor: cols.docente >= 0 ? String(best[cols.docente] || "").trim() : "",
    tipo: normalizeTipo(String(best[cols.tipo] || "")) as "T" | "P" | "LAB",
    inicio: cols.horaInicio >= 0 ? normalizeScheduleTime(best[cols.horaInicio]) || normTime(best[cols.horaInicio]) : "",
    fin: cols.horaFin >= 0 ? normalizeScheduleTime(best[cols.horaFin]) || normTime(best[cols.horaFin]) : "",
    estado: decodeEstado(String(best[cols.estado] || "")),
    reemplazo: cols.reemplazo >= 0 ? String(best[cols.reemplazo] || "").trim() : "",
    observacion: cols.obs >= 0 ? String(best[cols.obs] || "").trim() : "",
  };
}

function getDiaDataByDayId(diasData: DiasData, dayId: number) {
  const expected = ["", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"][dayId];
  if (!expected) return undefined;
  return Object.entries(diasData).find(([key]) => normalizeText(key) === expected)?.[1];
}

// --- Mapeo JS día de semana → clave del JSON ---
function getDiaKey(isoDate?: string): string {
  const DIAS = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];

  if (!isoDate) {
    const d = new Date();
    return DIAS[d.getDay()];
  }

  const d = new Date(isoDate + "T00:00:00");
  return DIAS[d.getDay()];
}

// --- Handler ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ahora = Date.now();
    let usoMemoria = true;
    const expectedAcademicVersion =
      typeof body?.expectedAcademicVersion === "string"
        ? body.expectedAcademicVersion
        : "";
    const expectedTemporaryVersion =
      typeof body?.expectedTemporaryVersion === "string"
        ? body.expectedTemporaryVersion
        : "";
    const memoryVersionMeta = (
      memoriaDias as unknown as {
        _meta?: { academicVersion?: string; temporaryVersion?: string };
      } | null
    )?._meta;
    const memoryAcademicVersion = memoryVersionMeta?.academicVersion || "";
    const memoryTemporaryVersion = memoryVersionMeta?.temporaryVersion || "";

    // 1. Usar memoria si todavía no venció
    if (
      !memoriaDias ||
      ahora - memoriaUltimaLectura > TTL_MS ||
      (expectedAcademicVersion && memoryAcademicVersion !== expectedAcademicVersion) ||
      (expectedTemporaryVersion && memoryTemporaryVersion !== expectedTemporaryVersion)
    ) {
      usoMemoria = false;
      console.log("🔄 Leyendo aulas_cache desde Supabase...");

      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from("aulas_cache")
        .select("dias, updated_at")
        .single();

      if (error || !data?.dias) {
        return Response.json(
          { ok: false, error: "Sin datos de aulas en cache" },
          { status: 503 }
        );
      }

      memoriaDias = data.dias as DiasData;
      memoriaUpdatedAt = data.updated_at ?? null;
      memoriaUltimaLectura = ahora;

      try {
        console.log("📦 Tamaño dias:", JSON.stringify(memoriaDias).length, "bytes");
      } catch {
        console.log("📦 No se pudo medir el tamaño de dias");
      }
    } else {
      console.log("⚡ Usando aulas desde memoria");
    }

    const diasData = memoriaDias;

    if (!diasData) {
      return Response.json(
        { ok: false, error: "No hay datos en memoria" },
        { status: 503 }
      );
    }
    const versionMeta = (diasData as unknown as {
      _meta?: { academicVersion?: string; temporaryVersion?: string };
    })._meta;

    // 2. Determinar qué día consultar
    const diaKey = getDiaKey(body?.fecha);
    const diaData = diasData[diaKey];

    console.log("Fecha solicitada:", body?.fecha);
    console.log("Día calculado:", diaKey);

    if (!diaData && !body?.resolveByDayId) {
      console.log("No hay datos para el día:", diaKey);
      return Response.json(
        { ok: false, error: `Sin datos para ${diaKey}` },
        { status: 404 }
      );
    }

    // 3. Procesar lista de clases
    if (Array.isArray(body?.classes)) {
      const results: Record<string, MatchResult> = {};

      for (const item of body.classes) {
        const key = String(item?.key || "");
        const qMateria = normalizeSubjectName(item?.materia);
        const qSeccion = normalizeSection(item?.seccion);
        const qTipo = normalizeClassType(item?.tipo);
        const qHora = normTime(item?.horaInicio);
        const itemDayData = body?.resolveByDayId
          ? getDiaDataByDayId(diasData, Number(item?.day_id))
          : diaData;
        const match = itemDayData
          ? matchEnDia(itemDayData, qMateria, qSeccion, qTipo, qHora)
          : { ok: true, found: false };
        results[key] = match;
      }

      return Response.json({
        ok: true,
        fromCache: usoMemoria,
        updatedAt: memoriaUpdatedAt,
        academicVersion: versionMeta?.academicVersion || null,
        temporaryVersion: versionMeta?.temporaryVersion || null,
        results,
      });
    }

    return Response.json(
      { ok: false, error: "Formato incorrecto" },
      { status: 400 }
    );
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "Error" },
      { status: 500 }
    );
  }
}
