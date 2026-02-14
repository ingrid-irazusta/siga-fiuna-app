"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { getSupabase } from "../../lib/supabaseClient";
import Card from "../../components/Card";

const PROFILE_KEY = "fiuna_os_profile_v1";
const MALLA_CACHE_PREFIX = "fiuna_os_malla_cache_v1";
const NOTAS_PREFIX = "fiuna_os_notas_finales_v4";

interface Profile {
  carrera: string;
  malla: string;
  ci: string;
}

interface MallaItem {
  semestre: number;
  materia: string;
}

interface NotaRow {
  id: string;
  base: boolean;
  semestre: number;
  materia: string;
  nota1: string | number;
  nota2: string | number;
  nota3: string | number;
  nota4?: string | number;
  nota5?: string | number;
  nota6?: string | number;
  optativaNombre?: string;
}

interface StorageKeyParams {
  carrera: string;
  plan: string;
  ci?: string;
}

interface MallaCacheKeyParams {
  carrera: string;
  plan: string;
}

interface KPIs {
  promedio: string;
  aprobadas: number;
  total: number;
  progresoPct: number;
}

type NotaValue = string | number | null | undefined;
type EstadoType = "PENDIENTE" | "APROBADO" | "AUN NO";

type NotaKey = "nota1" | "nota2" | "nota3" | "nota4" | "nota5" | "nota6";

function normText(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function safeParse<T = any>(raw: string | null): T | null {
  try {
    return JSON.parse(raw || "") as T;
  } catch {
    return null;
  }
}

function loadProfile(): Partial<Profile> {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = safeParse(raw);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function storageKey({ carrera, plan, ci }: StorageKeyParams): string {
  const c = normText(carrera);
  const p = String(plan || "2023");
  const id = String(ci || "").trim();
  return id ? `${NOTAS_PREFIX}:${c}:${p}:${id}` : `${NOTAS_PREFIX}:${c}:${p}`;
}

function mallaCacheKey({ carrera, plan }: MallaCacheKeyParams): string {
  return `${MALLA_CACHE_PREFIX}:${normText(carrera)}:${String(plan || "2023")}`;
}

function estadoFromNotas(...notas: NotaValue[]): EstadoType {
  const vals = (notas || [])
    .map((x) => (x === "" || x === null || typeof x === "undefined" ? null : Number(x)))
    .filter((x): x is number => Number.isFinite(x));

  if (!vals.length) return "PENDIENTE";
  if (vals.some((v) => v >= 2)) return "APROBADO";
  if (vals.some((v) => v === 1)) return "AUN NO";
  return "PENDIENTE";
}

function clampNotaInput(v: string | number): string | number {
  if (v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  const i = Math.round(n);
  if (i < 1) return 1;
  if (i > 5) return 5;
  return i;
}

function notasRowAll(r: NotaRow | undefined): number[] {
  if (!r) return [];
  return [r.nota1, r.nota2, r.nota3, r.nota4, r.nota5, r.nota6]
    .map((x) => (x === "" || x === null || typeof x === "undefined" ? null : Number(x)))
    .filter((x): x is number => x !== null && Number.isFinite(x) && x >= 1 && x <= 5);
}

function hasExtraNotas(r: NotaRow | undefined): boolean {
  if (!r) return false;
  return (
    typeof r.nota4 !== "undefined" ||
    typeof r.nota5 !== "undefined" ||
    typeof r.nota6 !== "undefined"
  );
}

function ensureExtraNotas(r: NotaRow): NotaRow {
  if (hasExtraNotas(r)) return r;
  return { ...r, nota4: "", nota5: "", nota6: "" };
}

function stripExtraNotas(r: NotaRow | undefined): Partial<NotaRow> {
  if (!r) return {};
  const { nota4, nota5, nota6, ...rest } = r;
  return rest;
}


function shouldHaveExtras(r: NotaRow | undefined): boolean {
  if (!r) return false;
  const n1 = Number(r?.nota1);
  const n2 = Number(r?.nota2);
  const n3 = Number(r?.nota3);
  return n1 === 1 && n2 === 1 && n3 === 1;
}

function reconcileExtras(r: NotaRow): NotaRow {
  if (shouldHaveExtras(r)) return ensureExtraNotas(r);
  return hasExtraNotas(r) ? (stripExtraNotas(r) as NotaRow) : r;
}

function enforceSinglePass(row: NotaRow, changedKey: NotaKey | undefined): NotaRow {
  const orderAll: NotaKey[] = ["nota1", "nota2", "nota3", "nota4", "nota5", "nota6"];

  const order = orderAll.filter((k) => typeof row?.[k] !== "undefined") as NotaKey[];

  const toNum = (v: NotaValue): number | null => {
    if (v === "" || v === null || typeof v === "undefined") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const changedVal = toNum(row?.[changedKey as NotaKey]);
  let passKey: NotaKey | null = null;

  if (changedKey && changedVal !== null && changedVal >= 2) {
    passKey = changedKey;
  } else {
    for (const k of order) {
      const n = toNum(row?.[k]);
      if (n !== null && n >= 2) {
        passKey = k;
        break;
      }
    }
  }

  if (!passKey) return row;


  const passIdx = order.indexOf(passKey as NotaKey);
  const out = { ...row } as NotaRow & Partial<Record<NotaKey, string | number | undefined>>;

  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const n = toNum(out?.[k]);

    if (k !== passKey && n !== null && n >= 2) (out as any)[k] = "";

    if (i > passIdx) (out as any)[k] = "";
  }

  return out;
}

function readMallaMaterias({ carrera, plan }: MallaCacheKeyParams): MallaItem[] {
  try {
    const raw = localStorage.getItem(mallaCacheKey({ carrera, plan }));
    const parsed = (safeParse<{ items?: any[] }>(raw) || {}) as { items?: any[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const filtered = items
      .map((it: any) => ({
        semestre: Number(it?.semestre) || 0,
        materia: String(it?.materia || "").trim(),
      }))
      .filter((x: MallaItem) => x.semestre > 0 && x.materia);
    filtered.sort((a: MallaItem, b: MallaItem) => a.semestre - b.semestre);
    return filtered;
  } catch {
    return [];
  }
}

function buildBaseRows(mallaItems: MallaItem[]): NotaRow[] {
  return mallaItems.map((it) => ({
    id: `base:${it.semestre}:${normText(it.materia)}`,
    base: true,
    semestre: it.semestre,
    materia: it.materia,
    nota1: "",
    nota2: "",
    nota3: "",
  }));
}

function mergeKeepNotas(existingRows: NotaRow[], baseRows: NotaRow[]): NotaRow[] {
  const byKey = new Map<string, NotaRow>();
  for (const r of existingRows || []) {
    const key = `${r.base ? "base" : "extra"}:${Number(r.semestre) || 0}:${normText(r.materia)}`;
    if (!byKey.has(key)) byKey.set(key, r);
  }

  const merged: NotaRow[] = [];
  for (const b of baseRows) {
    const key = `base:${Number(b.semestre) || 0}:${normText(b.materia)}`;
    const prev = byKey.get(key);
    if (prev) {
      merged.push({
        ...b,
        nota1: prev.nota1 ?? "",
        nota2: prev.nota2 ?? "",
        nota3: prev.nota3 ?? "",
        ...(hasExtraNotas(prev)
          ? { nota4: prev.nota4 ?? "", nota5: prev.nota5 ?? "", nota6: prev.nota6 ?? "" }
          : {}),
        optativaNombre: prev.optativaNombre ?? "",
      });
      byKey.delete(key);
    } else {
      merged.push(b);
    }
  }
  for (const r of existingRows || []) {
    if (!r.base) merged.push(r);
  }
  merged.sort((a, b) => {
    if ((a.semestre || 0) !== (b.semestre || 0)) return (a.semestre || 0) - (b.semestre || 0);
    if (a.base !== b.base) return a.base ? -1 : 1;
    return String(a.materia || "").localeCompare(String(b.materia || ""));
  });
  return merged;
}

export default function NotasFinalesPage() {
  const [userId, setUserId] = useState<string>("");
  const [profile, setProfile] = useState<Profile>({ carrera: "", malla: "2023", ci: "" });
  const [rows, setRows] = useState<NotaRow[]>([]);
  const [totalMalla, setTotalMalla] = useState<number>(0);

  useEffect(() => {
    const p = loadProfile();
    const carrera = String(p?.carrera || "").trim();
    const plan = p?.malla === "2013" || p?.malla === "2023" ? p.malla : "2023";
    const ci = String(p?.ci || "").trim();
    setProfile({ carrera, malla: plan, ci });
  }, []);

  useEffect(() => {
    try {
      const supabase = getSupabase();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user?.id) setUserId(session.user.id);
        else setUserId("");
      });

      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) setUserId(data.user.id);
      });

      return () => subscription?.unsubscribe();
    } catch (err) {
      console.error("Auth init error:", err);
    }
  }, []);

  useEffect(() => {
    if (!profile.carrera) return;

    const mallaItems = readMallaMaterias({ carrera: profile.carrera, plan: profile.malla });
    setTotalMalla(mallaItems.length);
    const baseRows = buildBaseRows(mallaItems);

    (async () => {
      let loaded: NotaRow[] = [];

      if (userId) {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("student_notes")
            .select("id,materia,nota1,nota2,nota3")
            .eq("user_id", userId);

          if (!error && Array.isArray(data)) {
            loaded = data.map((d: any) => {
              const materia = String(d.materia || "").trim();
              const key = normText(materia);
              const isBase = baseRows.some((b) => normText(b.materia) === key);
              const semestre = isBase
                ? baseRows.find((b) => normText(b.materia) === key)!.semestre
                : 0;
              return {
                id: String(d.id),
                base: !!isBase,
                semestre,
                materia: materia,
                nota1: d.nota1 ?? "",
                nota2: d.nota2 ?? "",
                nota3: d.nota3 ?? "",
              } as NotaRow;
            });
          } else {
            console.error("Error loading notes from DB:", error);
          }
        } catch (err) {
          console.error("Error reading notes from DB:", err);
        }
      } else {
        // fallback: localStorage for anonymous
        try {
          const key = storageKey({ carrera: profile.carrera, plan: profile.malla, ci: profile.ci });
          const raw = localStorage.getItem(key);
          const parsed = safeParse(raw);
          if (Array.isArray(parsed)) loaded = parsed;

          if (!loaded.length) {
            try {
              const legacyKey = key.replace(NOTAS_PREFIX, "fiuna_os_notas_finales_v3");
              const legacyRaw = localStorage.getItem(legacyKey);
              const legacyParsed = safeParse(legacyRaw);
              if (Array.isArray(legacyParsed)) loaded = legacyParsed;
            } catch {}
          }
        } catch (err) {
          /* ignore */
        }
      }

      const merged = mergeKeepNotas(loaded, baseRows);
      setRows(merged);
    })();
  }, [profile.carrera, profile.malla, profile.ci, userId]);

  useEffect(() => {
    if (!profile.carrera) return;

    const sync = async () => {
      if (!userId) {
        // fallback: save to localStorage
        try {
          const key = storageKey({ carrera: profile.carrera, plan: profile.malla, ci: profile.ci });
          localStorage.setItem(key, JSON.stringify(rows));
        } catch {}
        return;
      }

      try {
        const supabase = getSupabase();

        // fetch existing DB notes for the user
        const { data: dbAll, error: fetchErr } = await supabase
          .from("student_notes")
          .select("id,materia")
          .eq("user_id", userId);

        if (fetchErr) console.error("Error fetching existing notes:", fetchErr);

        const dbMap = new Map<string, string>();
        if (Array.isArray(dbAll)) {
          for (const d of dbAll) dbMap.set(normText(String(d.materia || "")), String(d.id));
        }

        const currentMaterias = new Set(rows.map((r) => normText(r.materia)));

        // delete removed notes
        for (const [mat, id] of dbMap.entries()) {
          if (!currentMaterias.has(mat)) {
            await supabase.from("student_notes").delete().eq("id", id);
          }
        }

        // upsert current rows (nota1..nota3)
        for (const r of rows) {
          const materiaKey = normText(r.materia);
          const payload = {
            user_id: userId,
            materia: materiaKey,
            nota1: r.nota1 === "" ? null : Number(r.nota1),
            nota2: r.nota2 === "" ? null : Number(r.nota2),
            nota3: r.nota3 === "" ? null : Number(r.nota3),
          } as any;

          const existingId = dbMap.get(materiaKey);
          if (existingId) {
            await supabase.from("student_notes").update(payload).eq("id", existingId);
          } else {
            await supabase.from("student_notes").insert(payload);
          }
        }
      } catch (err) {
        console.error("Error syncing notes to DB:", err);
      }
    };

    sync();
  }, [rows, profile, userId]);

  const semestres = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (Number(r.semestre) > 0) s.add(Number(r.semestre));
    const arr = Array.from(s).sort((a, b) => a - b);
    return arr.length ? arr : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }, [rows]);

  const kpis = useMemo((): KPIs => {
    const todasLasNotas: number[] = [];
    const aprobadaByMateria = new Map<string, boolean>();
    const baseSet = new Set<string>();

    for (const r of rows) {
      const matKey = normText(r.materia);
      if (!matKey) continue;
      if (r.base) baseSet.add(matKey);
      const vals = notasRowAll(r);
      for (const v of vals) todasLasNotas.push(v);
      if (vals.some((v) => v >= 2)) aprobadaByMateria.set(matKey, true);
    }

    const promedio = todasLasNotas.length
      ? todasLasNotas.reduce((a, b) => a + b, 0) / todasLasNotas.length
      : 0;

    let aprobadas = 0;
    for (const k of baseSet) {
      if (aprobadaByMateria.get(k)) aprobadas += 1;
    }
    const total = totalMalla || baseSet.size || 0;
    const progresoPct = total ? (aprobadas / total) * 100 : 0;

    return {
      promedio: promedio ? promedio.toFixed(2).replace(".", ",") : "0,00",
      aprobadas,
      total,
      progresoPct,
    };
  }, [rows, totalMalla]);

  const updateRow = (id: string, patch: Partial<NotaRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const updateRowReconcile = (id: string, patch: Partial<NotaRow>) => {
    const rawKey = Object.keys(patch || {})[0];
    const changedKey = ["nota1", "nota2", "nota3", "nota4", "nota5", "nota6"].includes(
      rawKey as string
    )
      ? (rawKey as NotaKey)
      : undefined;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = reconcileExtras({ ...r, ...patch });
        return enforceSinglePass(next, changedKey);
      })
    );
  };

  const focusByData = (rowIdx: number, colKey: string) => {
    const el = document.querySelector(
      `[data-nf-row="${rowIdx}"][data-nf-col="${colKey}"]`
    ) as HTMLElement;
    if (el && typeof el.focus === "function") el.focus();
  };

  const handleEnterMove = (rowIdx: number, colKey: string) => {
    const cols3 = ["nota1", "nota2", "nota3"];
    const cols6 = ["nota1", "nota2", "nota3", "nota4", "nota5", "nota6"];
    const r = rows[rowIdx];
    const useCols = hasExtraNotas(r) ? cols6 : cols3;
    const i = useCols.indexOf(colKey);
    if (i === -1) return;
    if (i < useCols.length - 1) {
      focusByData(rowIdx, useCols[i + 1]);
      return;
    }
    const nextIdx = rowIdx + 1;
    if (nextIdx < rows.length) focusByData(nextIdx, "nota1");
  };

  const addRow = (sem: number) => {
    const id = `extra:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setRows((prev) => {
      const next: NotaRow[] = [
        ...prev,
        { id, base: false, semestre: sem, materia: "", nota1: "", nota2: "", nota3: "" },
      ];
      next.sort((a, b) => {
        if ((a.semestre || 0) !== (b.semestre || 0)) return (a.semestre || 0) - (b.semestre || 0);
        if (a.base !== b.base) return a.base ? -1 : 1;
        return String(a.materia || "").localeCompare(String(b.materia || ""));
      });
      return next;
    });
  };

  return (
    <div className="nfWrap">
      <Card className="nfKpiCard">
        <div className="nfKpis">
          <div className="nfKpi">
            <div className="nfKpiValue">{kpis.promedio}</div>
            <div className="nfKpiLabel">Promedio General</div>
          </div>
          <div className="nfKpi">
            <div className="nfKpiValue">
              {kpis.aprobadas}/{kpis.total}
            </div>
            <div className="nfKpiLabel">Materias Aprobadas</div>
          </div>
          <div className="nfKpi">
            <div className="nfKpiValue">{kpis.progresoPct.toFixed(2).replace(".", ",")}%</div>
            <div className="nfKpiLabel">Progreso</div>
          </div>
        </div>
        <div className="nfProgress">
          <div
            className="nfProgressBar"
            style={{ width: `${Math.min(100, Math.max(0, kpis.progresoPct))}%` }}
          />
        </div>
      </Card>

      {semestres.map((sem) => {
        const list = rows.filter((r) => Number(r.semestre) === sem);
        return (
          <div key={sem} className="nfSemBlock">
            <div className="nfSemHeader">{sem}ER SEMESTRE</div>

            <Card>
              <div className="nfTable nfTable3">
                <div className="nfTh">ASIGNATURA</div>
                <div className="nfTh nfThNotas">NOTAS</div>
                <div className="nfTh">ESTADO</div>

                {list.map((r) => {
                  const idx = rows.findIndex((x) => x.id === r.id);
                  const estado = estadoFromNotas(
                    r.nota1,
                    r.nota2,
                    r.nota3,
                    r.nota4,
                    r.nota5,
                    r.nota6
                  );
                  const isOptativa = normText(r.materia).startsWith("optativa");
                  return (
                    <Fragment key={r.id}>
                      <div className="nfTd">
                        {r.base ? (
                          <div className="nfMateriaWrap">
                            <span className="nfMateriaBase">{r.materia}</span>
                            {isOptativa && (
                              <input
                                className="nfInput nfOpt"
                                value={r.optativaNombre || ""}
                                onChange={(e) => updateRow(r.id, { optativaNombre: e.target.value })}
                                placeholder="Nombre de tu optativa"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="nfExtraRowWrap">
                            <input
                              className="nfInput"
                              value={r.materia}
                              onChange={(e) => updateRow(r.id, { materia: e.target.value })}
                              placeholder="Materia (opcional)"
                            />
                            <button
                              type="button"
                              className="nfDel"
                              onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                              title="Eliminar fila"
                              aria-label="Eliminar fila"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="nfTd nfNotasCell">
                        <div className="nfNotasGrid">
                          <input
                            className="nfInput nfNota"
                            value={r.nota1}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(e) =>
                              updateRowReconcile(r.id, { nota1: clampNotaInput(e.target.value) })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleEnterMove(idx, "nota1");
                              }
                            }}
                            data-nf-row={idx}
                            data-nf-col="nota1"
                            placeholder="-"
                          />
                          <input
                            className="nfInput nfNota"
                            value={r.nota2}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(e) =>
                              updateRowReconcile(r.id, { nota2: clampNotaInput(e.target.value) })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleEnterMove(idx, "nota2");
                              }
                            }}
                            data-nf-row={idx}
                            data-nf-col="nota2"
                            placeholder="-"
                          />
                          <input
                            className="nfInput nfNota"
                            value={r.nota3}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(e) =>
                              updateRowReconcile(r.id, { nota3: clampNotaInput(e.target.value) })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const v3 = clampNotaInput(e.currentTarget.value);
                                setRows((prev) =>
                                  prev.map((x) => {
                                    if (x.id !== r.id) return x;
                                    const base = { ...x, nota3: v3 };
                                    return reconcileExtras(base);
                                  })
                                );
                                const willExtra =
                                  Number(r?.nota1) === 1 &&
                                  Number(r?.nota2) === 1 &&
                                  Number(v3) === 1;
                                if (willExtra) setTimeout(() => focusByData(idx, "nota4"), 0);
                                else handleEnterMove(idx, "nota3");
                              }
                            }}
                            data-nf-row={idx}
                            data-nf-col="nota3"
                            placeholder="-"
                          />
                        </div>

                        {hasExtraNotas(r) && (
                          <div className="nfNotasGrid nfNotasGridExtra">
                            <input
                              className="nfInput nfNota"
                              value={r.nota4 ?? ""}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              onChange={(e) => {
                                const v = clampNotaInput(e.target.value);
                                setRows((prev) =>
                                  prev.map((x) => {
                                    if (x.id !== r.id) return x;
                                    const next = { ...ensureExtraNotas(x), nota4: v };
                                    return enforceSinglePass(next, "nota4");
                                  })
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleEnterMove(idx, "nota4");
                                }
                              }}
                              data-nf-row={idx}
                              data-nf-col="nota4"
                              placeholder="-"
                            />
                            <input
                              className="nfInput nfNota"
                              value={r.nota5 ?? ""}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              onChange={(e) => {
                                const v = clampNotaInput(e.target.value);
                                setRows((prev) =>
                                  prev.map((x) => {
                                    if (x.id !== r.id) return x;
                                    const next = { ...ensureExtraNotas(x), nota5: v };
                                    return enforceSinglePass(next, "nota5");
                                  })
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleEnterMove(idx, "nota5");
                                }
                              }}
                              data-nf-row={idx}
                              data-nf-col="nota5"
                              placeholder="-"
                            />
                            <input
                              className="nfInput nfNota"
                              value={r.nota6 ?? ""}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              onChange={(e) => {
                                const v = clampNotaInput(e.target.value);
                                setRows((prev) =>
                                  prev.map((x) => {
                                    if (x.id !== r.id) return x;
                                    const next = { ...ensureExtraNotas(x), nota6: v };
                                    return enforceSinglePass(next, "nota6");
                                  })
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleEnterMove(idx, "nota6");
                                }
                              }}
                              data-nf-row={idx}
                              data-nf-col="nota6"
                              placeholder="-"
                            />
                          </div>
                        )}
                      </div>

                      <div className="nfTd">
                        <div
                          className={
                            "nfEstado " +
                            (estado === "APROBADO" ? "ok" : estado === "AUN NO" ? "bad" : "pend")
                          }
                        >
                          {estado}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              <div className="nfAddRow">
                <button type="button" className="btnSoft" onClick={() => addRow(sem)}>
                  ➕ Agregar fila
                </button>
              </div>
            </Card>
          </div>
        );
      })}
      <style jsx>{`
        .nfKpiCard {
          padding: 14px;
        }
        .nfKpis {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .nfKpi {
          text-align: center;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.9);
        }
        .nfKpiValue {
          font-size: 26px;
          font-weight: 900;
          color: var(--primary);
        }
        .nfKpiLabel {
          font-size: 12px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.7);
          margin-top: 4px;
        }
        .nfProgress {
          margin-top: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.25);
          overflow: hidden;
        }
        .nfProgressBar {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(0, 176, 255, 0.35), rgba(0, 176, 255, 0.95));
        }

        .nfSemBlock {
          margin-top: 14px;
        }
        .nfSemHeader {
          font-weight: 950;
          color: var(--primary);
          letter-spacing: 0.02em;
          margin: 8px 0 8px;
        }

        .nfTable {
          display: grid;
          grid-template-columns: minmax(240px, 1.4fr) minmax(220px, 1fr) 140px;
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
        }
        .nfTh {
          background: rgba(0, 176, 255, 0.95);
          color: white;
          font-weight: 900;
          font-size: 12px;
          padding: 10px 10px;
          border-right: 1px solid rgba(255, 255, 255, 0.15);
        }
        .nfThNotas {
          text-align: center;
        }
        .nfTd {
          padding: 10px;
          border-top: 1px solid var(--border);
          border-right: 1px solid var(--border);
          background: white;
        }
        .nfNotasCell {
          padding: 10px;
        }
        .nfNotasGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(44px, 1fr));
          gap: 8px;
        }
        .nfNotasGridExtra {
          margin-top: 8px;
        }
        .nfMateriaBase {
          font-weight: 800;
          color: rgba(15, 23, 42, 0.9);
        }
        .nfMateriaWrap {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .nfExtraRowWrap {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .nfDel {
          border: 1px solid var(--border);
          background: white;
          border-radius: 12px;
          padding: 8px 10px;
          font-weight: 950;
          cursor: pointer;
          line-height: 1;
        }
        .nfDel:active {
          transform: translateY(1px);
        }
        .nfOpt {
          max-width: 320px;
          font-weight: 800;
        }
        .nfInput {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 8px 10px;
          font-weight: 800;
          background: rgba(255, 255, 255, 0.92);
        }
        .nfNota {
          text-align: center;
        }
        .nfEstado {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 8px 10px;
          border-radius: 12px;
          font-weight: 950;
          font-size: 12px;
        }
        .nfEstado.ok {
          background: rgba(34, 197, 94, 0.18);
          color: rgba(21, 128, 61, 1);
        }
        .nfEstado.bad {
          background: rgba(239, 68, 68, 0.16);
          color: rgba(185, 28, 28, 1);
        }
        .nfEstado.pend {
          background: rgba(148, 163, 184, 0.2);
          color: rgba(51, 65, 85, 1);
        }
        .nfAddRow {
          padding: 12px;
          display: flex;
          justify-content: flex-end;
        }

        @media (max-width: 520px) {
          .nfKpiValue {
            font-size: 22px;
          }
          .nfTable {
            grid-template-columns: 1fr 1fr 110px;
          }
          .nfNotasGrid {
            grid-template-columns: repeat(3, minmax(36px, 1fr));
            gap: 6px;
          }
          .nfTh {
            font-size: 11px;
            padding: 9px 8px;
          }
          .nfTd {
            padding: 8px;
          }
          .nfInput {
            padding: 7px 8px;
          }
          .nfMateriaWrap {
            flex-direction: column;
            align-items: flex-start;
          }
          .nfExtraRowWrap {
            gap: 8px;
          }
          .nfDel {
            padding: 7px 9px;
          }
          .nfOpt {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}