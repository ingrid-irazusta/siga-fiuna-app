export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabaseClient";

// --- Tipos ---
interface EstadoInfo { icon: string; text: string; code: string; }
interface MatchResult {
  ok: boolean; found: boolean;
  aula?: string; estado?: EstadoInfo;
  reemplazo?: string; observacion?: string; error?: string;
}

// --- Helpers (los mismos que ya tenés) ---
function stripDiacritics(s?: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function romanToArabicTokens(s: string): string {
  const map: Record<string,string> = {
    "X":"10","IX":"9","VIII":"8","VII":"7","VI":"6",
    "V":"5","IV":"4","III":"3","II":"2","I":"1"
  };
  return s.replace(/\b(X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, m => map[m]||m);
}
function normalizeText(s?: string): string {
  return romanToArabicTokens(stripDiacritics(String(s)))
    .toUpperCase().replace(/\s+/g," ").trim();
}
function normTime(s?: string): string {
  const m = String(s||"").match(/(\d{1,2})[:.](\d{2})/);
  if(!m) return "";
  return `${m[1].padStart(2,"0")}:${m[2]}`;
}
function normalizeTipo(val?: string): string {
  const t = normalizeText(val);
  if(!t) return "";
  if(t==="T"||t.startsWith("TEO")) return "T";
  if(t==="P"||t.startsWith("PRA")) return "P";
  return t[0];
}
function decodeEstado(code?: string): EstadoInfo {
  const c = normalizeText(code||"");
  if(!c) return {icon:"⏳",text:"Aún no llegó",code:""};
  if(c==="P") return {icon:"✅",text:"Presente",code:"P"};
  if(c==="A") return {icon:"❌",text:"Ausente",code:"A"};
  if(c==="AA") return {icon:"⚠️",text:"Ausente c/ Aviso",code:"AA"};
  if(c==="R") return {icon:"🔄",text:"Reemplazo",code:"R"};
  if(c==="T") return {icon:"ℹ️",text:"Tutoría",code:"T"};
  if(c==="REC") return {icon:"📅",text:"Recuperación",code:"REC"};
  return {icon:"ℹ️",text:c,code:c};
}
function minutesFromTime(t: string): number|null {
  const nt = normTime(t);
  if(!nt) return null;
  const [h,m] = nt.split(":").map(x=>parseInt(x,10));
  if(Number.isNaN(h)||Number.isNaN(m)) return null;
  return h*60+m;
}

// --- Detectar índices de columnas desde la fila de cabeceras ---
function pickColIndexes(cabeceras: any[]) {
  const h = cabeceras.map(x => normalizeText(String(x||"")));
  const find = (...keys: string[]) => {
    for(const k of keys){
      const idx = h.findIndex(x => x.includes(k));
      if(idx !== -1) return idx;
    }
    return -1;
  };
  return {
    materia:    find("ASIGNATURA","MATERIA"),
    seccion:    find("SECC","SECCION","SECCIÓN"),
    tipo:       find("TIPO"),
    docente:    find("DOCENTE","PROF"),
    obs:        find("OBS","OBSERV"),
    reemplazo:  find("REEMPLAZ","SUPL"),
    horaInicio: find("HORA INICIO","INICIO"),
    horaFin:    find("HORA FIN","FIN"),
    aula:       find("AULA"),
    estado:     find("ESTADO","P - R","P-R"),
  };
}

// --- Match para un día específico ---
function matchEnDia(
  diaData: { cabeceras: any[]; filas: any[][] },
  qMateria: string, qSeccion: string, qTipo: string, qHora: string
): MatchResult {
  if(!diaData?.filas?.length) return {ok:true, found:false};

  const cols = pickColIndexes(diaData.cabeceras || []);
  if(cols.materia < 0 || cols.aula < 0) return {ok:false, found:false, error:"Columnas no detectadas"};

  const cands: any[][] = [];

  for(const row of diaData.filas) {
    const mat = normalizeText(String(row[cols.materia]||""));
    const sec = normalizeText(String(row[cols.seccion]||""));
    const tipo = normalizeTipo(String(row[cols.tipo]||""));

    if(!mat || mat !== qMateria) continue;
    if(sec !== qSeccion) continue;
    if(normalizeTipo(qTipo) !== tipo) continue;
    cands.push(row);
  }

  if(!cands.length) return {ok:true, found:false};

  // Elegir el candidato más cercano en hora
  const qMin = minutesFromTime(qHora);
  let best = cands[0];
  if(qMin !== null && cols.horaInicio >= 0) {
    let bestScore = Infinity;
    for(const r of cands) {
      const rMin = minutesFromTime(String(r[cols.horaInicio]||""));
      const diff = rMin === null ? 1e9 : Math.abs(rMin - qMin);
      if(diff < bestScore) { bestScore = diff; best = r; }
    }
  }

  return {
    ok: true,
    found: true,
    aula:        String(best[cols.aula]||"").trim() || "No hallada",
    estado:      decodeEstado(String(best[cols.estado]||"")),
    reemplazo:   cols.reemplazo >= 0 ? String(best[cols.reemplazo]||"").trim() : "",
    observacion: cols.obs >= 0 ? String(best[cols.obs]||"").trim() : "",
  };
}

// --- Mapeo JS día de semana → clave del JSON ---
function getDiaKey(isoDate?: string): string {
  const DIAS = ["DOMINGO","LUNES","MARTES","MIERCOLES","JUEVES","VIERNES","SABADO"];
  if(!isoDate) {
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

    // Leer de Supabase
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("aulas_cache")
      .select("dias, updated_at")
      .single();

    console.log("aulasCache:", data);

    if(error || !data?.dias) {
      return Response.json({ok:false, error:"Sin datos de aulas en cache"}, {status:503});
    }

    const diasData = data.dias as Record<string, {cabeceras: any[]; filas: any[][]}>;

    // Determinar qué día consultar
    const diaKey = getDiaKey(body?.fecha);
    const diaData = diasData[diaKey];

    // DEBUG: Log días disponibles
    console.log("Días disponibles en cache:", Object.keys(diasData));
    console.log("Fecha solicitada:", body?.fecha);
    console.log("Día calculado:", diaKey);

    if(!diaData) {
      console.log("No hay datos para el día:", diaKey);
      return Response.json({ok:false, error:`Sin datos para ${diaKey}`}, {status:404});
    }

    // Procesar lista de clases
    if(Array.isArray(body?.classes)) {
      const results: Record<string, MatchResult> = {};
      for(const item of body.classes) {
        const key = String(item?.key||"");
        results[key] = matchEnDia(
          diaData,
          normalizeText(item?.materia),
          normalizeText(item?.seccion),
          normalizeText(item?.tipo),
          normTime(item?.horaInicio)
        );
      }
      return Response.json({ok:true, fromCache:true, updatedAt: data.updated_at, results});
    }

    return Response.json({ok:false, error:"Formato incorrecto"}, {status:400});
  } catch(e:any) {
    return Response.json({ok:false, error:e?.message||"Error"}, {status:500});
  }
}