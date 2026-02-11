export const dynamic = "force-dynamic";

// CSV público de TU Google Sheets
const SHEET_CSV =
  "https://docs.google.com/spreadsheets/d/1vkHJBV4c46_JWM2uiEdeiltHH9RN0VLhaSGPU6udYP4/export?format=csv&gid=0";

// --- Tipos ---
interface Cols {
  hasHeaders: boolean;
  materia: number;
  seccion: number;
  tipo: number;
  obs: number;
  reemplazo: number;
  horaInicio: number;
  aula: number;
  estado: number;
  profTitular: number;
}

interface EstadoInfo {
  icon: string;
  text: string;
  code: string;
}

interface SheetData {
  ts: number;
  rows: string[][];
  cols: Cols;
  dataRows: string[][];
  fromCache: boolean;
  ttlMs: number;
}

interface Query {
  materia: string;
  seccion: string;
  tipo: string;
  horaInicio: string;
}

interface MatchResult {
  ok: boolean;
  found: boolean;
  aula?: string;
  estado?: EstadoInfo;
  reemplazo?: string;
  observacion?: string;
  error?: string;
}

// --- Cache en memoria ---
let _cache: {
  ts: number;
  rows: string[][] | null;
  cols: Cols | null;
  dataRows: string[][] | null;
} = { ts: 0, rows: null, cols: null, dataRows: null };

// --- Helpers ---
function stripDiacritics(s?: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function romanToArabicTokens(s: string): string {
  const map: Record<string, string> = {
    "X": "10", "IX": "9", "VIII": "8", "VII": "7",
    "VI": "6", "V": "5", "IV": "4", "III": "3",
    "II": "2", "I": "1",
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
  const m = String(s || "").match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { row.push(cur); cur = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(c => String(c).trim() !== "")) rows.push(row);
      row = []; continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (row.some(c => String(c).trim() !== "")) rows.push(row);
  return rows;
}

function pickCols(headerRow: string[]): Cols {
  const h = headerRow.map(x => normalizeText(x));
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const idx = h.findIndex(x => x.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const hasHeaders = h.some(x => x.length > 0 && !/^\d+$/.test(x));
  const fallback: Cols = {
    hasHeaders: false, materia: 3, seccion: 4, tipo: 5,
    obs: 7, reemplazo: 8, horaInicio: 9, aula: 11, estado: 12, profTitular: -1,
  };
  if (!hasHeaders) return fallback;

  const mapped: Cols = {
    hasHeaders: true,
    materia: find("ASIGNATURA","MATERIA","NOMBRE"),
    seccion: find("SECCION","SECCIÓN"),
    tipo: find("TIPO","T/P","TP"),
    obs: find("OBSERVACION","OBS"),
    reemplazo: find("REEMPLAZ","SUPL","SUPLENTE"),
    horaInicio: find("HORA INICIO","INICIO"),
    aula: find("AULA"),
    estado: find("ESTADO","ASIST"),
    profTitular: find("PROF","DOCENTE"),
  };

  const critical = [mapped.materia, mapped.seccion, mapped.tipo, mapped.aula, mapped.estado];
  if (critical.some(i => i < 0)) return fallback;
  return mapped;
}

function normalizeTipo(val?: string): string {
  const t = normalizeText(val);
  if (!t) return "";
  if (t === "T" || t.startsWith("TEO")) return "T";
  if (t === "P" || t.startsWith("PRA") || t.startsWith("PRAC")) return "P";
  return t[0];
}

function tipoMatches(qTipo: string, rowTipo: string): boolean {
  return normalizeTipo(qTipo) === normalizeTipo(rowTipo);
}

function minutesFromTime(t: string): number | null {
  const nt = normTime(t);
  if (!nt) return null;
  const [h,m] = nt.split(":").map(x => parseInt(x,10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}

function pickBestByTime(cands: {r:string[]}[], qHora: string, cols: Cols): {r:string[]} | null {
  if (!cands.length) return null;
  const qMin = minutesFromTime(qHora);
  if (qMin === null) return cands.find(c => String(c.r[cols.aula]||"").trim()) || cands[0];

  let best: { c: {r:string[]}, score:number } | null = null;
  for (const c of cands) {
    const rMin = minutesFromTime(c.r[cols.horaInicio]);
    const diff = rMin===null ? 1e9 : Math.abs(rMin-qMin);
    const aula = String(c.r[cols.aula]||"").trim();
    const score = diff*1000 + (aula?0:1);
    if(!best||score<best.score) best={c,score};
  }
  return best ? best.c : cands[0];
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

// --- Cache fetch ---
async function getSheetDataCached(): Promise<SheetData> {
  const now = Date.now();
  const TTL = 60*1000;

  if(_cache.dataRows && _cache.cols && now-_cache.ts<TTL){
    return {
      rows: _cache.rows!,
      cols: _cache.cols!,
      dataRows: _cache.dataRows!,
      ts: _cache.ts,
      fromCache: true,
      ttlMs: Math.max(0,TTL-(now-_cache.ts))
    };
  }

  const res = await fetch(SHEET_CSV,{cache:"no-store",headers:{"Accept":"text/csv,text/plain,*/*"}});
  const csv = await res.text();
  if(!res.ok) throw Object.assign(new Error(`No se pudo leer el CSV (HTTP ${res.status})`),{status:502});

  const firstChunk = (csv||"").slice(0,300).toLowerCase();
  if(firstChunk.includes("<html")||firstChunk.includes("accounts.google")||firstChunk.includes("signin"))
    throw Object.assign(new Error("El enlace no devuelve CSV (parece HTML)"),{status:502,debug:"HTML_en_respuesta"});

  const rows = parseCSV(csv);
  if(!rows.length) throw Object.assign(new Error("CSV vacío"),{status:502});
  const maxCols = Math.max(...rows.map(r=>r.length));
  if(maxCols<13) throw Object.assign(new Error(`CSV no tiene suficientes columnas (${maxCols})`),{status:502,debug:`cols=${maxCols}`});

  const cols = pickCols(rows[0]);
  const dataRows = cols.hasHeaders ? rows.slice(1): rows;
  _cache={ts:now,rows,cols,dataRows};
  return {rows,cols,dataRows,ts:now,fromCache:false,ttlMs:TTL};
}

// --- Query ---
function buildQuery(body:any): Query {
  return {
    materia: normalizeText(body?.materia),
    seccion: normalizeText(body?.seccion),
    tipo: normalizeText(body?.tipo),
    horaInicio: normTime(body?.horaInicio)
  };
}

function matchOne(q:Query,dataRows:string[][],cols:Cols): MatchResult{
  if(!q.materia) return {ok:false,found:false,error:"Falta materia"};
  if(!q.tipo) return {ok:false,found:false,error:"Falta tipo"};
  if(!q.seccion) return {ok:false,found:false,error:"Falta seccion"};

  const cands:{r:string[]}[]=[];
  for(const r of dataRows){
    const mat = normalizeText(r[cols.materia]||"");
    const sec = normalizeText(r[cols.seccion]||"");
    const tipo = normalizeTipo(r[cols.tipo]||"");
    if(!mat||mat!==q.materia) continue;
    if(sec!==q.seccion) continue;
    if(!tipoMatches(q.tipo,tipo)) continue;
    cands.push({r});
  }

  if(!cands.length) return {ok:true,found:false};
  const best = pickBestByTime(cands,q.horaInicio,cols)||cands[0];
  const r = best.r;
  const estadoInfo = decodeEstado(r[cols.estado]||"");
  const reemplazo = cols.reemplazo>=0?String(r[cols.reemplazo]||"").trim():"";
  const obs = cols.obs>=0?String(r[cols.obs]||"").trim():"";
  const aula = String(r[cols.aula]||"").trim();
  return {ok:true,found:true,aula:aula||"No hallada",estado:estadoInfo,reemplazo:reemplazo||"",observacion:obs||""};
}

// --- Handler ---
export async function POST(req: Request){
  try{
    const body = await req.json();
    const {dataRows,cols,fromCache,ttlMs}=await getSheetDataCached();

    if(Array.isArray(body?.classes)){
      const results: Record<string,MatchResult>={};
      for(const item of body.classes){
        const q = buildQuery(item);
        const key = String(item?.key||"");
        const res = matchOne(q,dataRows,cols);
        if(key) results[key]=res;
      }
      return Response.json({ok:true,fromCache,cooldownMs:ttlMs,results});
    }

    const q = buildQuery(body);
    if(!q.materia) return Response.json({ok:false,error:"Falta materia"},{status:400});
    const one = matchOne(q,dataRows,cols);
    return Response.json({...one,fromCache,cooldownMs:ttlMs});
  }catch(e:any){
    const status = e?.status||500;
    return Response.json({ok:false,error:e?.message||"Error",debug:e?.debug||""},{status});
  }
}
