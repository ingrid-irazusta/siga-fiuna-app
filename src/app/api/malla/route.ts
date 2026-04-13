export const runtime = "nodejs";

const CACHE_TTL_MS = 60_000;

interface MallaPayload {
  carrera: string;
  plan: string;
  intensificacion?: string;
  materias: any[];
}

interface CacheEntry {
  ts: number;
  dataByKey: Map<string, MallaPayload>;
}

let cache: CacheEntry = {
  ts: 0,
  dataByKey: new Map(),
};

// --- Helpers ---
function getBaseUrl(): string {
  return (
    process.env.MALLA_APPS_SCRIPT_URL ||
    "https://script.google.com/macros/s/AKfycbxq_I1OqRrjHRqeDHe27RqmvCIUYTYDi7vgOzFLFVbAq_MdjMGPWTvjykZXJaDdglZHDw/exec"
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// --- GET handler ---
export async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const carrera = (searchParams.get("carrera") || "").trim();
    const plan = (searchParams.get("plan") || "").trim();
    const intensificacion = (searchParams.get("intensificacion") || "").trim();

    if (!carrera || !plan) {
      return json({ ok: false, error: "Faltan parámetros: carrera y plan" }, 400);
    }

    const usaIntensificacion =
      carrera === "Ingeniería Electrónica" && plan === "2023";

    if (usaIntensificacion && !intensificacion) {
      return json(
        {
          ok: false,
          error: "Falta el parámetro intensificacion para Ingeniería Electrónica 2023",
        },
        400
      );
    }

    const key = usaIntensificacion
      ? `${carrera}||${plan}||${intensificacion}`
      : `${carrera}||${plan}`;

    const now = Date.now();

    // Limpiar cache si expiró
    if (now - cache.ts > CACHE_TTL_MS) {
      cache.ts = now;
      cache.dataByKey = new Map();
    }

    if (cache.dataByKey.has(key)) {
      return json({ ok: true, cached: true, ...cache.dataByKey.get(key) });
    }

    const base = getBaseUrl();
    const token = process.env.MALLA_TOKEN || "";

    const url =
      `${base}?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}` +
      (usaIntensificacion
        ? `&intensificacion=${encodeURIComponent(intensificacion)}`
        : "") +
      (token ? `&token=${encodeURIComponent(token)}` : "");

    const r = await fetch(url, { method: "GET" });
    const text = await r.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          ok: false,
          error: "Respuesta no válida desde Apps Script (no es JSON)",
          debug: text.slice(0, 200),
        },
        502
      );
    }

    if (!r.ok || data?.ok === false) {
      return json(
        {
          ok: false,
          error: data?.error || "No se pudo leer la BD_Malla",
          debug: data,
        },
        502
      );
    }

    const payload: MallaPayload = {
      carrera: data.carrera || carrera,
      plan: String(data.plan || plan),
      intensificacion: usaIntensificacion
        ? String(data.intensificacion || intensificacion)
        : "",
      materias: Array.isArray(data.materias) ? data.materias : [],
    };

    cache.dataByKey.set(key, payload);

    return json({ ok: true, cached: false, ...payload });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Error inesperado" }, 500);
  }
}
