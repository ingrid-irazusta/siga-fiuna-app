"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { getSupabase } from "../../lib/supabaseClient";
import Card from "../../components/Card";

const MALLA_CACHE_PREFIX = "fiuna_os_malla_cache_v1";

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
type SaveStatus = "idle" | "saving" | "saved" | "error";

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

async function loadProfileFromDB(userId: string): Promise<Profile | null> {
  if (!userId) return null;

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("user_profiles")
      .select("carrera, malla, ci")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error("Error loading profile from DB:", error);
      return null;
    }

    return data && typeof data === "object" ? (data as Profile) : null;
  } catch (error) {
    console.error("Error in loadProfileFromDB:", error);
    return null;
  }
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

  const changedVal = changedKey ? toNum(row?.[changedKey]) : null;
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

  const passIdx = order.indexOf(passKey);
  const out = { ...row } as NotaRow & Partial<Record<NotaKey, string | number | undefined>>;

  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const n = toNum(out?.[k]);

    if (k !== passKey && n !== null && n >= 2) {
      out[k] = "";
    }

    if (i > passIdx) {
      out[k] = "";
    }
  }

  return out;
}

async function readMallaMaterias(carrera: string, plan: string): Promise<MallaItem[]> {
  try {
    const cacheKey = mallaCacheKey({ carrera, plan });
    const raw = localStorage.getItem(cacheKey);
    const parsed = (safeParse<{ items?: any[] }>(raw) || {}) as { items?: any[] };
    const cachedItems = Array.isArray(parsed.items) ? parsed.items : [];

    if (cachedItems.length > 0) {
      const filtered = cachedItems
        .map((it: any) => ({
          semestre: Number(it?.semestre) || 0,
          materia: String(it?.materia || "").trim(),
        }))
        .filter((x: MallaItem) => x.semestre > 0 && x.materia);

      filtered.sort((a: MallaItem, b: MallaItem) => a.semestre - b.semestre);
      return filtered;
    }

    const response = await fetch(
      `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}`
    );

    const data = await response.json();

    if (!response.ok || !data?.ok) {
      console.error("Error fetching malla:", data?.error);
      return [];
    }

    const items = Array.isArray(data.materias) ? data.materias : [];

    const filtered = items
      .map((it: any) => ({
        semestre: Number(it?.semestre) || 0,
        materia: String(it?.materia || "").trim(),
      }))
      .filter((x: MallaItem) => x.semestre > 0 && x.materia);

    filtered.sort((a: MallaItem, b: MallaItem) => a.semestre - b.semestre);

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ items: filtered }));
    } catch { }

    return filtered;
  } catch (error) {
    console.error("Error in readMallaMaterias:", error);
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
    const key = `base:${Number(r.semestre) || 0}:${normText(r.materia)}`;
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
          ? {
            nota4: prev.nota4 ?? "",
            nota5: prev.nota5 ?? "",
            nota6: prev.nota6 ?? "",
          }
          : {}),
        optativaNombre: prev.optativaNombre ?? "",
      });
    } else {
      merged.push(b);
    }
  }

  merged.sort((a, b) => {
    if ((a.semestre || 0) !== (b.semestre || 0)) return (a.semestre || 0) - (b.semestre || 0);
    return String(a.materia || "").localeCompare(String(b.materia || ""));
  });

  return merged;
}

export default function NotasFinalesPage() {
  const [userId, setUserId] = useState<string>("");
  const [profile, setProfile] = useState<Profile>({ carrera: "", malla: "2023", ci: "" });
  const [rows, setRows] = useState<NotaRow[]>([]);
  const [totalMalla, setTotalMalla] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [notesReady, setNotesReady] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [globalSaveStatus, setGlobalSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    try {
      const supabase = getSupabase();

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id) setUserId(session.user.id);
        else setUserId("");
      });

      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) setUserId(data.user.id);
      });

      return () => {
        subscription?.unsubscribe();
      };
    } catch (err) {
      console.error("Auth init error:", err);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const loadProfile = async () => {
      const p = await loadProfileFromDB(userId);
      if (cancelled) return;

      if (!p) {
        setProfile({ carrera: "", malla: "2023", ci: "" });
        return;
      }

      const carrera = String(p.carrera || "").trim();
      const plan = p.malla === "2013" || p.malla === "2023" ? p.malla : "2023";
      const ci = String(p.ci || "").trim();

      setProfile({ carrera, malla: plan, ci });
    };

    loadProfile();

    try {
      const supabase = getSupabase();

      const subscription = supabase
        .channel(`user_profiles_${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_profiles",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (!cancelled && payload.new) {
              const newProfile = payload.new as any;
              const carrera = String(newProfile.carrera || "").trim();
              const plan =
                newProfile.malla === "2013" || newProfile.malla === "2023"
                  ? newProfile.malla
                  : "2023";
              const ci = String(newProfile.ci || "").trim();

              setProfile({ carrera, malla: plan, ci });
            }
          }
        )
        .subscribe();

      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    } catch (error) {
      console.error("Error setting up profile subscription:", error);
      return () => {
        cancelled = true;
      };
    }
  }, [userId]);

  const loadNotasFinales = useCallback(async () => {
    if (!profile.carrera || !userId) return;

    setLoading(true);
    setNotesReady(false);

    const mallaItems = await readMallaMaterias(profile.carrera, profile.malla);
    setTotalMalla(mallaItems.length);

    const baseRows = buildBaseRows(mallaItems);

    let loaded: NotaRow[] = [];

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from("student_notes")
        .select("id,materia,nota1,nota2,nota3,nota4,nota5,nota6,optativa_nombre")
        .eq("user_id", userId);

      if (error) throw error;

      if (Array.isArray(data)) {
        loaded = data.map((d: any) => {
          const materia = String(d.materia || "").trim();
          const key = normText(materia);
          const baseMatch = baseRows.find((b) => normText(b.materia) === key);

          return {
            id: String(d.id),
            base: !!baseMatch,
            semestre: baseMatch ? baseMatch.semestre : 0,
            materia,
            nota1: d.nota1 ?? "",
            nota2: d.nota2 ?? "",
            nota3: d.nota3 ?? "",
            ...(d.nota4 !== null && typeof d.nota4 !== "undefined" ? { nota4: d.nota4 } : {}),
            ...(d.nota5 !== null && typeof d.nota5 !== "undefined" ? { nota5: d.nota5 } : {}),
            ...(d.nota6 !== null && typeof d.nota6 !== "undefined" ? { nota6: d.nota6 } : {}),
            ...(d.optativa_nombre ? { optativaNombre: d.optativa_nombre } : {}),
          };
        });
      }
    } catch (err) {
      console.error("Error reading notes from DB:", err);
    }

    const merged = mergeKeepNotas(loaded, baseRows);

    setRows(merged);
    setLoading(false);
    setNotesReady(true);
  }, [profile.carrera, profile.malla, userId]);

  useEffect(() => {
    loadNotasFinales();
  }, [loadNotasFinales]);

  const semestres = useMemo(() => {
    const s = new Set<number>();

    for (const r of rows) {
      if (Number(r.semestre) > 0) s.add(Number(r.semestre));
    }

    const arr = Array.from(s).sort((a: number, b: number) => a - b);
    return arr.length ? arr : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }, [rows]);

  const saveAllNotesToDB = async () => {
  if (!userId || !profile.carrera) {
    setGlobalSaveStatus("error");
    alert("No se pudo guardar: falta usuario o carrera.");
    return;
  }

  setSavingAll(true);
  setGlobalSaveStatus("saving");

  try {
    const supabase = getSupabase();

    const validRows = rows.filter((r) => {
      const materia = String(r.materia || "").trim();
      return Boolean(materia);
    });

    const payloads = validRows.map((r) => ({
      user_id: userId,
      materia: r.materia,
      nota1: r.nota1 === "" ? null : Number(r.nota1),
      nota2: r.nota2 === "" ? null : Number(r.nota2),
      nota3: r.nota3 === "" ? null : Number(r.nota3),
      nota4: r.nota4 === "" || typeof r.nota4 === "undefined" ? null : Number(r.nota4),
      nota5: r.nota5 === "" || typeof r.nota5 === "undefined" ? null : Number(r.nota5),
      nota6: r.nota6 === "" || typeof r.nota6 === "undefined" ? null : Number(r.nota6),
      optativa_nombre: r.optativaNombre || null,
    }));

    const { error } = await supabase.from("student_notes").upsert(payloads, {
      onConflict: "user_id,materia",
    });

    if (error) throw error;

    window.dispatchEvent(new CustomEvent("notasUpdated", { detail: { userId } }));

    setGlobalSaveStatus("saved");
    setIsEditing(false);

    setTimeout(() => {
      setGlobalSaveStatus("idle");
    }, 2200);
  } catch (err) {
    console.error("Error saving all notes:", err);
    setGlobalSaveStatus("error");
    alert("No se pudieron guardar las notas. Revisá la consola o Supabase.");
  } finally {
    setSavingAll(false);
  }
};

const handleCancelEdit = async () => {
  setIsEditing(false);
  setGlobalSaveStatus("idle");
  await loadNotasFinales();
};

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

    if (vals.some((v) => v >= 2)) {
      aprobadaByMateria.set(matKey, true);
    }
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
  if (!isEditing) return;
  setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
};

const updateRowReconcile = (id: string, patch: Partial<NotaRow>) => {
  if (!isEditing) return;

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

  if (nextIdx < rows.length) {
    focusByData(nextIdx, "nota1");
  }
};

const addRow = (sem: number) => {
  if (!isEditing) return;

  const id = `extra:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  setRows((prev) => {
    const next: NotaRow[] = [
      ...prev,
      {
        id,
        base: false,
        semestre: sem,
        materia: "",
        nota1: "",
        nota2: "",
        nota3: "",
      },
    ];

    next.sort((a: NotaRow, b: NotaRow) => {
      if ((a.semestre || 0) !== (b.semestre || 0)) return (a.semestre || 0) - (b.semestre || 0);
      if (a.base !== b.base) return a.base ? -1 : 1;
      return String(a.materia || "").localeCompare(String(b.materia || ""));
    });

    return next;
  });
};

return (
  <div className="nfWrap nfWrapWithSticky">
    <div className="nfStickyActions">
      <div>
        <div className="nfStickyTitle">Notas finales</div>
        <span className="nfStickySub">
          {isEditing ? "Modo edición activado" : "Modo lectura"}
          {globalSaveStatus === "saved" && " · Guardado correctamente"}
          {globalSaveStatus === "error" && " · Error al guardar"}
          {globalSaveStatus === "saving" && " · Guardando..."}
        </span>
      </div>

      <div className="nfStickyButtons">
        {!isEditing ? (
          <button
            type="button"
            className="btnSoft primary"
            onClick={() => setIsEditing(true)}
            disabled={loading || !notesReady}
          >
            ✏️ Editar notas
          </button>
        ) : (
          <>
            <button type="button" className="btnSoft" onClick={handleCancelEdit} disabled={savingAll}>
              Cancelar
            </button>

            <button
              type="button"
              className="btnSoft primary"
              onClick={saveAllNotesToDB}
              disabled={savingAll}
            >
              {savingAll ? "Guardando..." : "Guardar cambios"}
            </button>
          </>
        )}
      </div>
    </div>

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
          <div className="nfSemHeaderRow">
            <div className="nfSemHeader">{sem}° SEMESTRE</div>
          </div>

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
                              disabled={!isEditing}
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
                            disabled={!isEditing}
                            onChange={(e) => updateRow(r.id, { materia: e.target.value })}
                            placeholder="Materia (opcional)"
                          />

                          {isEditing && (
                            <button
                              type="button"
                              className="nfDel"
                              onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                              title="Eliminar fila"
                              aria-label="Eliminar fila"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="nfTd nfNotasCell">
                      <div className="nfNotasGrid">
                        <input
                          className="nfInput nfNota"
                          value={r.nota1}
                          disabled={!isEditing}
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
                          disabled={!isEditing}
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
                          disabled={!isEditing}
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
                            disabled={!isEditing}
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
                            disabled={!isEditing}
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
                            disabled={!isEditing}
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

            {isEditing && (
              <div className="nfAddRow">
                <button type="button" className="btnSoft" onClick={() => addRow(sem)}>
                  ➕ Agregar fila
                </button>
              </div>
            )}
          </Card>
        </div>
      );
    })}

    <style jsx>{`
        .nfStickyActions {
         position: fixed;
         top: 70px;
          left: 0;
         right: 0;
          width: calc(100% - 32px);
          max-width: 1100px;
          margin: 0 auto;
          z-index: 50;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          margin-bottom: 14px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        }
.nfWrapWithSticky {
  padding-top: 100px;
}
        .nfStickyTitle {
          font-weight: 950;
          color: var(--text);
        }

        .nfStickySub {
          display: block;
          margin-top: 2px;
          font-size: 12px;
          font-weight: 800;
          color: var(--muted);
        }

        .nfStickyButtons {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .btnSoft.primary {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }

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
          background: var(--card);
        }

        .nfKpiValue {
          font-size: 26px;
          font-weight: 900;
          color: var(--primary);
        }

        .nfKpiLabel {
          font-size: 12px;
          font-weight: 800;
          color: var(--muted);
          margin-top: 4px;
        }

        .nfProgress {
          margin-top: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--border2);
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

        .nfSemHeaderRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 8px 0 8px;
        }

        .nfSemHeader {
          font-weight: 950;
          color: var(--primary);
          letter-spacing: 0.02em;
          flex: 1;
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
          background: var(--card);
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
          color: var(--text);
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
          background: var(--card);
          border-radius: 12px;
          padding: 8px 10px;
          font-weight: 950;
          cursor: pointer;
          line-height: 1;
          color: var(--text);
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

.nfInput:disabled {
  background: transparent;
  border: none;
  box-shadow: none;
  pointer-events: none;
  font-weight: 900;
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
          .nfStickyActions {
  top: 58px;
  width: calc(100% - 20px);
  flex-direction: column;
  align-items: stretch;
}
  .nfWrapWithSticky {
  padding-top: 135px;
}

          .nfStickyButtons {
            justify-content: space-between;
          }

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

          .nfSemHeaderRow {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .nfSemHeader {
            margin: 8px 0 0;
          }
        }
      `}</style>
  </div>
);
}