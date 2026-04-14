export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabaseClient";

function normalizeHora(hora: any): string {
  if (!hora) return "";

  let str = String(hora).trim();

  // Caso 1: ya bien (7:30)
  if (/^\d{1,2}:\d{2}$/.test(str)) return str;

  // Caso 2: tipo 929 → 09:29
  if (/^\d{3,4}$/.test(str)) {
    const h = str.slice(0, -2);
    const m = str.slice(-2);
    return `${h.padStart(2, "0")}:${m}`;
  }

  // Caso 3: tipo 11:39:20 → cortar segundos
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) {
    return str.slice(0, 5);
  }

  // Caso 4: número decimal de Google Sheets
  const num = Number(str);
  if (!isNaN(num)) {
    const totalMinutes = Math.round(num * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return "";
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
          String(h || "").toUpperCase().includes("HORA INICIO")
        );
        const idxHoraFin = cabeceras.findIndex((h: any) =>
          String(h || "").toUpperCase().includes("HORA FIN")
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
    console.log("=== DIAS NORMALIZADOS SAMPLE ===");
    for (const [dia, data] of Object.entries(diasNormalizados)) {
      const filas = Array.isArray((data as any)?.filas) ? (data as any).filas : [];
      console.log(dia, filas.slice(0, 5));
    }
    const supabase = getSupabaseServer();
    const res = await supabase
      .from("aulas_cache")
      .upsert({ id: 1, dias: diasNormalizados, updated_at: new Date().toISOString() });

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
