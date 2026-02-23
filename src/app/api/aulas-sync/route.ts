export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabaseClient";

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

    const supabase = getSupabaseServer();
    const res = await supabase
      .from("aulas_cache")
      .upsert({ id: 1, dias: body.dias, updated_at: new Date().toISOString() });

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
