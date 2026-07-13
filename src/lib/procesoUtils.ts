export interface ChildRow {
  rid: string;
  label: string;
  peso: number;
  pct: number;
}

export interface Row {
  rid: string;
  label: string;
  peso: number;
  min: number;
  pct: number;
  isGroup?: boolean;
  children?: ChildRow[];
}

export interface ExoneracionResult {
  ok: boolean;
  nota: number | null;
  umbral: 71 | 81;
  puntosNecesarios: number;
  tipoCurso: "básico" | "profesional";
}

export function normText(s: string | null | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function clampNum(v: string | number, min: number, max: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

export function cloneRowsDeep(rows: Row[] | null | undefined): Row[] {
  return Array.isArray(rows)
    ? rows.map((r) => ({ ...r, children: Array.isArray(r.children) ? r.children.map((c) => ({ ...c })) : undefined }))
    : [];
}

export function calcRowTotal(peso: number, pct: number): number {
  const w = clampNum(peso, 0, 999);
  const p = clampNum(pct, 0, 100);
  return (w * p) / 100;
}

export function rowTotalRaw(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return calcRowTotal(peso, pct);
}

export function rowTotalOf(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return calcRowTotal(peso, pct);
}

export interface GroupTotals {
  pesoGrupo: number;
  totalGrupo: number;
  pctGrupo: number;
}

export function groupTotals(groupRow: Row): GroupTotals {
  const kids = Array.isArray(groupRow?.children) ? groupRow.children : [];
  const hasKids = kids.length > 0;

  const pesoGrupo = hasKids
    ? kids.reduce((acc, k) => acc + clampNum((k as any)?.peso, 0, 999), 0)
    : clampNum((groupRow as any)?.peso, 0, 999);

  const sumKids = kids.reduce((acc, k) => acc + rowTotalOf(k), 0);
  const totalGrupo = Math.min(sumKids, pesoGrupo);

  const pctGrupo = pesoGrupo > 0 ? Math.round((totalGrupo / pesoGrupo) * 100) : 0;

  return { pesoGrupo, totalGrupo, pctGrupo };
}

export function calcCumpleMinimos(rows: Row[]): boolean {
  const arr = Array.isArray(rows) ? rows : [];

  for (const r of arr) {
    const minPct = clampNum((r as any)?.min, 0, 100);
    if (!minPct) continue;

    const hasKids = Array.isArray((r as any)?.children) && (r as any).children.length > 0;
    const peso = hasKids ? groupTotals(r).pesoGrupo : clampNum((r as any)?.peso, 0, 999);
    const minPts = Math.round((peso * minPct) / 100);
    const totalPts = hasKids ? groupTotals(r).totalGrupo : rowTotalOf(r);

    if (totalPts < minPts) return false;
  }

  return true;
}

export function calcProcessTotal(rows: Row[]): number {
  const arr = Array.isArray(rows) ? rows : [];

  const sum = arr.reduce((acc, r) => {
    const hasKids = Array.isArray((r as any)?.children) && (r as any).children.length > 0;

    if (hasKids) {
      const kids = Array.isArray((r as any).children) ? (r as any).children : [];
      return acc + kids.reduce((a: number, k: ChildRow) => a + rowTotalRaw(k), 0);
    }

    return acc + rowTotalRaw(r);
  }, 0);

  return Math.round(sum);
}

export function calcPesoTotal(rows: Row[]): number {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.reduce((acc, r) => {
    const hasKids = Array.isArray((r as any)?.children) && (r as any).children.length > 0;
    if (hasKids) return acc + groupTotals(r).pesoGrupo;
    return acc + clampNum((r as any)?.peso, 0, 999);
  }, 0);
}

export function calcExoneracion(semestre: number, P: number): ExoneracionResult {
  const semestreNormalizado = Math.max(1, Math.trunc(Number(semestre) || 1));
  const p = clampNum(P, 0, 100);
  const esBasico = semestreNormalizado <= 4;
  const umbral: 71 | 81 = esBasico ? 71 : 81;
  const ok = p >= umbral;
  const nota = !ok ? null : p >= 91 ? 5 : p >= 81 ? 4 : 3;

  return {
    ok,
    nota,
    umbral,
    puntosNecesarios: Math.max(0, Math.ceil(umbral - p)),
    tipoCurso: esBasico ? "básico" : "profesional",
  };
}

export function calcTotalConRecu(rows: Row[], recuPct: number): number {
  const baseTotal = calcProcessTotal(rows);
  const t = recuTarget(rows);
  const parcial = rows.find((x) => x.rid === t.rid);
  const pesoParcial = clampNum((parcial as any)?.peso ?? 0, 0, 999);
  const recuPts = Math.round((pesoParcial * clampNum(recuPct, 0, 100)) / 100);
  return Math.round(baseTotal - t.pts + recuPts);
}

export interface RecuTarget {
  rid: string;
  label: string;
  pts: number;
}

export function recuTarget(rows: Row[]): RecuTarget {
  const p1Pts = calcParcialPts(rows, "p1");
  const p2Pts = calcParcialPts(rows, "p2");
  if (p1Pts <= p2Pts) return { rid: "p1", label: "Parcial 1", pts: p1Pts };
  return { rid: "p2", label: "Parcial 2", pts: p2Pts };
}

export function calcParcialPts(rows: Row[], rid: string): number {
  const r = rows.find((x) => x.rid === rid);
  if (!r) return 0;
  return rowTotalOf(r);
}

export interface ResultadoFinalFIUNA {
  rendimientoPonderado: number;
  notaFinal: 1 | 2 | 3 | 4 | 5;
}

export function calcResultadoFinalFIUNA(procesoPct: number, examenFinalPct: number): ResultadoFinalFIUNA {
  const proceso = clampNum(procesoPct, 0, 100);
  const examenFinal = clampNum(examenFinalPct, 0, 100);
  const rendimientoPonderado = clampNum(Math.round(Math.max(proceso, (0.3 * proceso) + (0.7 * examenFinal))), 0, 100);
  const notaFinal: ResultadoFinalFIUNA["notaFinal"] =
    rendimientoPonderado >= 91 ? 5 :
    rendimientoPonderado >= 81 ? 4 :
    rendimientoPonderado >= 71 ? 3 :
    rendimientoPonderado >= 60 ? 2 : 1;

  return { rendimientoPonderado, notaFinal };
}

export function calcNotaFinalFIUNA(baseFinalProceso: number, finalPct: number): ResultadoFinalFIUNA["notaFinal"] {
  return calcResultadoFinalFIUNA(baseFinalProceso, finalPct).notaFinal;
}

export function createEmptyRows(): Row[] {
  return [
    { rid: "p1", label: "Parcial 1", peso: 0, min: 0, pct: 0 },
    { rid: "p2", label: "Parcial 2", peso: 0, min: 0, pct: 0 },
    {
      rid: "g_talleres",
      label: "Talleres",
      peso: 0,
      min: 0,
      pct: 0,
      isGroup: true,
      children: [
        { rid: "t1", label: "Taller 1", peso: 0, pct: 0 },
        { rid: "t2", label: "Taller 2", peso: 0, pct: 0 },
      ],
    },
  ];
}
