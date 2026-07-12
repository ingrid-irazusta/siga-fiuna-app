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
  const S = Number(semestre) || 0;
  const p = Number(P) || 0;

  if (S > 0 && S <= 4) {
    if (p >= 91) return { ok: true, nota: 5 };
    if (p >= 81) return { ok: true, nota: 4 };
    if (p >= 71) return { ok: true, nota: 3 };
    if (p >= 61) return { ok: true, nota: 2 };
    if (p >= 51) return { ok: true, nota: 1 };
    return { ok: false, nota: null };
  }

  if (S >= 5) {
    if (p >= 91) return { ok: true, nota: 5 };
    if (p >= 81) return { ok: true, nota: 4 };
    if (p >= 71) return { ok: true, nota: 3 };
    if (p >= 61) return { ok: true, nota: 2 };
    if (p >= 51) return { ok: true, nota: 1 };
    return { ok: false, nota: null };
  }

  return { ok: false, nota: null };
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

export function calcNotaFinalFIUNA(baseFinalProceso: number, finalPct: number): number {
  const base = clampNum(baseFinalProceso, 0, 100);
  const pct = clampNum(finalPct, 0, 100);
  if (pct < 40) return 1;
  return Number(((base * 0.6) + (pct * 0.4)).toFixed(1));
}

export function createEmptyRows(): Row[] {
  return [
    { rid: "p1", label: "Parcial 1", peso: 0, min: 0, pct: 0 },
    { rid: "p2", label: "Parcial 2", peso: 0, min: 0, pct: 0 },
    { rid: "final", label: "Final", peso: 0, min: 0, pct: 0 },
  ];
}
