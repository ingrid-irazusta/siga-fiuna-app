"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { getSupabase } from "../../lib/supabaseClient";
import Card from "../../components/Card";

const MALLA_CACHE_PREFIX = "fiuna_os_malla_cache_v1";

interface Profile {
  carrera: string;
  malla: string;
  ci: string;
  intensificacion: string;
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
  attempts: NoteAttempt[];
  optativaNombre?: string;
}

interface NoteAttempt {
  attemptNumber: number;
  nota: string | number;
}

interface StudentNoteSavePayload {
  materia: string;
  optativa_nombre: string | null;
  attempts: Array<{ attempt_number: number; nota: number }>;
}

interface MallaCacheKeyParams {
  carrera: string;
  plan: string;
  intensificacion: string;
}

interface KPIs {
  promedio: string;
  aprobadas: number;
  total: number;
  progresoPct: number;
}

type EstadoType = "PENDIENTE" | "APROBADO" | "AUN NO";
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

function prepareMallaItems(items: any[]): MallaItem[] {
  const seen = new Set<string>();

  const prepared = items
    .map((it: any) => ({
      semestre: Number(it?.semestre) || 0,
      materia: String(it?.materia || "").trim(),
    }))
    .filter((item: MallaItem) => item.semestre > 0 && item.materia)
    .filter((item: MallaItem) => {
      const key = `${item.semestre}:${normText(item.materia)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  prepared.sort((a: MallaItem, b: MallaItem) => a.semestre - b.semestre);
  return prepared;
}

function validateUniqueNotePayloads(
  payloads: StudentNoteSavePayload[]
): { payloads: StudentNoteSavePayload[]; conflictingMaterias: string[] } {
  const groups = new Map<string, StudentNoteSavePayload[]>();

  for (const payload of payloads) {
    const key = normText(payload.materia);
    const group = groups.get(key);
    if (group) group.push(payload);
    else groups.set(key, [payload]);
  }

  const uniquePayloads: StudentNoteSavePayload[] = [];
  const conflictingMaterias: string[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (group.length === 1) {
      uniquePayloads.push(first);
      continue;
    }

    const signatures = new Set(
      group.map((payload) =>
        JSON.stringify([
          normText(payload.materia),
          payload.attempts,
          payload.optativa_nombre,
        ])
      )
    );

    if (signatures.size === 1) {
      uniquePayloads.push(first);
      if (process.env.NODE_ENV === "development") {
        console.warn("Notas Finales: materias duplicadas idénticas eliminadas", {
          materia: first.materia,
          duplicadosEliminados: group.length - 1,
        });
      }
      continue;
    }

    conflictingMaterias.push(first.materia);
  }

  return { payloads: uniquePayloads, conflictingMaterias };
}

async function loadProfileFromDB(userId: string): Promise<Profile | null> {
  if (!userId) return null;

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("user_profiles")
      .select("carrera, malla, ci, intensificacion")
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

function usaIntensificacion(carrera: string, plan: string): boolean {
  return carrera === "Ingeniería Electrónica" && plan === "2023";
}

function mallaCacheKey({
  carrera,
  plan,
  intensificacion,
}: MallaCacheKeyParams): string {
  const baseKey = `${MALLA_CACHE_PREFIX}:${normText(carrera)}:${String(plan || "2023")}`;
  return usaIntensificacion(carrera, plan)
    ? `${baseKey}:${normText(intensificacion)}`
    : baseKey;
}

function validAttempts(attempts: NoteAttempt[] | undefined): Array<{ attemptNumber: number; nota: number }> {
  const byNumber = new Map<number, number>();
  for (const attempt of attempts || []) {
    const attemptNumber = Number(attempt.attemptNumber);
    const nota = Number(attempt.nota);
    if (
      Number.isInteger(attemptNumber) &&
      attemptNumber > 0 &&
      Number.isFinite(nota) &&
      nota >= 1 &&
      nota <= 5
    ) {
      byNumber.set(attemptNumber, nota);
    }
  }
  return Array.from(byNumber, ([attemptNumber, nota]) => ({ attemptNumber, nota }))
    .sort((a, b) => a.attemptNumber - b.attemptNumber);
}

function estadoFromNotas(attempts: NoteAttempt[]): EstadoType {
  const vals = validAttempts(attempts).map((attempt) => attempt.nota);

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
  return r ? validAttempts(r.attempts).map((attempt) => attempt.nota) : [];
}

function attemptValue(attempts: NoteAttempt[], attemptNumber: number): string | number {
  return attempts.find((attempt) => attempt.attemptNumber === attemptNumber)?.nota ?? "";
}

function updateAttempt(
  attempts: NoteAttempt[],
  attemptNumber: number,
  nextValue: string | number
): NoteAttempt[] {
  const withoutCurrent = attempts.filter((attempt) => attempt.attemptNumber !== attemptNumber);
  if (nextValue === "") return withoutCurrent.sort((a, b) => a.attemptNumber - b.attemptNumber);

  const nota = Number(nextValue);
  const withCurrent = [...withoutCurrent, { attemptNumber, nota }];
  if (nota >= 2) {
    return withCurrent
      .filter((attempt) => attempt.attemptNumber <= attemptNumber)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }
  return withCurrent.sort((a, b) => a.attemptNumber - b.attemptNumber);
}

function visibleAttemptNumbers(attempts: NoteAttempt[], isEditing: boolean): number[] {
  const stored = validAttempts(attempts);
  if (!isEditing) return stored.map((attempt) => attempt.attemptNumber);

  const firstPass = stored.find((attempt) => attempt.nota >= 2)?.attemptNumber;
  const lastStored = stored.length ? stored[stored.length - 1].attemptNumber : 0;
  if (firstPass) {
    return Array.from({ length: Math.max(firstPass, lastStored) }, (_, index) => index + 1);
  }

  let visibleCount = Math.max(3, Math.ceil(Math.max(lastStored, 1) / 3) * 3);
  const byNumber = new Map(stored.map((attempt) => [attempt.attemptNumber, attempt.nota]));
  const currentBlockIsFullOfOnes = Array.from(
    { length: visibleCount },
    (_, index) => byNumber.get(index + 1) === 1
  ).every(Boolean);
  if (currentBlockIsFullOfOnes) visibleCount += 3;

  return Array.from({ length: visibleCount }, (_, index) => index + 1);
}

function legacyAttempts(row: any): NoteAttempt[] {
  const attempts: NoteAttempt[] = [];
  for (let attemptNumber = 1; attemptNumber <= 6; attemptNumber += 1) {
    const raw = row?.[`nota${attemptNumber}`];
    if (raw === null || typeof raw === "undefined" || raw === "") continue;
    const nota = Number(raw);
    if (Number.isFinite(nota) && nota >= 1 && nota <= 5) {
      attempts.push({ attemptNumber, nota });
    }
  }
  return attempts;
}

function mergeAttemptSources(legacy: NoteAttempt[], current: NoteAttempt[]): NoteAttempt[] {
  const merged = new Map<number, NoteAttempt>();
  for (const attempt of legacy) merged.set(attempt.attemptNumber, attempt);
  for (const attempt of current) merged.set(attempt.attemptNumber, attempt);
  return Array.from(merged.values()).sort((a, b) => a.attemptNumber - b.attemptNumber);
}

async function readMallaMaterias(
  carrera: string,
  plan: string,
  intensificacion: string
): Promise<MallaItem[]> {
  try {
    const cacheKey = mallaCacheKey({ carrera, plan, intensificacion });
    const raw = localStorage.getItem(cacheKey);
    const parsed = (safeParse<{ items?: any[] }>(raw) || {}) as { items?: any[] };
    const cachedItems = Array.isArray(parsed.items) ? parsed.items : [];

    if (cachedItems.length > 0) {
      return prepareMallaItems(cachedItems);
    }

    const url = usaIntensificacion(carrera, plan)
      ? `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}&intensificacion=${encodeURIComponent(intensificacion || "")}`
      : `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}`;

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok || !data?.ok) {
      console.error("Error fetching malla:", data?.error);
      return [];
    }

    const items = Array.isArray(data.materias) ? data.materias : [];
    const filtered = prepareMallaItems(items);

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
    attempts: [],
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
        attempts: prev.attempts,
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
  const [profile, setProfile] = useState<Profile>({
    carrera: "",
    malla: "2023",
    ci: "",
    intensificacion: "",
  });
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
        setProfile({ carrera: "", malla: "2023", ci: "", intensificacion: "" });
        return;
      }

      const carrera = String(p.carrera || "").trim();
      const plan = p.malla === "2013" || p.malla === "2023" ? p.malla : "2023";
      const ci = String(p.ci || "").trim();
      const intensificacion = String(p.intensificacion || "").trim();

      setProfile({ carrera, malla: plan, ci, intensificacion });
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
              const intensificacion = String(newProfile.intensificacion || "").trim();

              setProfile({ carrera, malla: plan, ci, intensificacion });
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

    const mallaItems = await readMallaMaterias(
      profile.carrera,
      profile.malla,
      profile.intensificacion
    );
    setTotalMalla(mallaItems.length);

    const baseRows = buildBaseRows(mallaItems);

    let loaded: NotaRow[] = [];

    try {
      const supabase = getSupabase();

      const [legacyResult, attemptsResult] = await Promise.all([
        supabase
          .from("student_notes")
          .select("id,materia,nota1,nota2,nota3,nota4,nota5,nota6,optativa_nombre")
          .eq("user_id", userId),
        supabase
          .from("student_note_attempts")
          .select("materia,attempt_number,nota")
          .eq("user_id", userId)
          .order("attempt_number", { ascending: true }),
      ]);

      if (legacyResult.error) throw legacyResult.error;

      const attemptsByMateria = new Map<string, NoteAttempt[]>();
      if (!attemptsResult.error && Array.isArray(attemptsResult.data)) {
        for (const attempt of attemptsResult.data as any[]) {
          const key = normText(String(attempt.materia || ""));
          const current = attemptsByMateria.get(key) || [];
          current.push({
            attemptNumber: Number(attempt.attempt_number),
            nota: Number(attempt.nota),
          });
          attemptsByMateria.set(key, current);
        }
      } else if (attemptsResult.error && process.env.NODE_ENV === "development") {
        console.warn(
          "Notas Finales: student_note_attempts no disponible; se usa el fallback legacy.",
          attemptsResult.error
        );
      }

      if (Array.isArray(legacyResult.data)) {
        loaded = legacyResult.data.map((d: any) => {
          const materia = String(d.materia || "").trim();
          const key = normText(materia);
          const baseMatch = baseRows.find((b) => normText(b.materia) === key);

          return {
            id: String(d.id),
            base: !!baseMatch,
            semestre: baseMatch ? baseMatch.semestre : 0,
            materia,
            attempts: mergeAttemptSources(
              legacyAttempts(d),
              attemptsByMateria.get(key) || []
            ),
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
  }, [profile.carrera, profile.malla, profile.intensificacion, userId]);

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
      const validRows = rows.filter((r) => {
        const materia = String(r.materia || "").trim();
        return Boolean(materia);
      });

      const candidatePayloads: StudentNoteSavePayload[] = validRows.map((r) => ({
        materia: r.materia,
        optativa_nombre: r.optativaNombre || null,
        attempts: validAttempts(r.attempts).map((attempt) => ({
          attempt_number: attempt.attemptNumber,
          nota: attempt.nota,
        })),
      }));

      const { payloads, conflictingMaterias } =
        validateUniqueNotePayloads(candidatePayloads);

      if (conflictingMaterias.length > 0) {
        setGlobalSaveStatus("error");
        alert(
          "Se encontraron materias repetidas con notas diferentes. " +
          "Revise las filas duplicadas antes de guardar.\n\n" +
          "Materia:\n" +
          conflictingMaterias.map((materia) => `- ${materia}`).join("\n")
        );
        return;
      }

      const supabase = getSupabase();
      const { error } = await supabase.rpc("save_student_note_attempts", {
        p_rows: payloads,
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
      alert(
        "No se pudieron guardar las notas:\n" +
        (err instanceof Error ? err.message : JSON.stringify(err))
      );
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

  const updateRowAttempt = (id: string, attemptNumber: number, value: string | number) => {
    if (!isEditing) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, attempts: updateAttempt(r.attempts, attemptNumber, value) }
          : r
      )
    );
  };

  const focusByData = (rowIdx: number, attemptNumber: number) => {
    const el = document.querySelector(
      `[data-nf-row="${rowIdx}"][data-nf-attempt="${attemptNumber}"]`
    ) as HTMLElement;

    if (el && typeof el.focus === "function") el.focus();
  };

  const handleEnterMove = (rowIdx: number, attemptNumber: number) => {
    window.setTimeout(() => {
      const nextAttempt = document.querySelector(
        `[data-nf-row="${rowIdx}"][data-nf-attempt="${attemptNumber + 1}"]`
      ) as HTMLElement;
      if (nextAttempt && typeof nextAttempt.focus === "function") {
        nextAttempt.focus();
        return;
      }

      if (rowIdx + 1 < rows.length) focusByData(rowIdx + 1, 1);
    }, 0);
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
          attempts: [],
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

                  const estado = estadoFromNotas(r.attempts);

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
                        {isEditing ? (
                          <div className="nfAttemptsEditor">
                            {visibleAttemptNumbers(r.attempts, true).map((attemptNumber) => (
                              <label className="nfAttemptEditor" key={attemptNumber}>
                                <span>{attemptNumber}</span>
                                <input
                                  className="nfInput nfNota"
                                  value={attemptValue(r.attempts, attemptNumber)}
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  aria-label={`Oportunidad ${attemptNumber}`}
                                  onChange={(event) =>
                                    updateRowAttempt(
                                      r.id,
                                      attemptNumber,
                                      clampNotaInput(event.target.value)
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      handleEnterMove(idx, attemptNumber);
                                    }
                                  }}
                                  data-nf-row={idx}
                                  data-nf-attempt={attemptNumber}
                                />
                              </label>
                            ))}
                          </div>
                        ) : validAttempts(r.attempts).length ? (
                          <div className="nfAttemptsRead" aria-label={`Notas de ${r.materia}`}>
                            {validAttempts(r.attempts).map((attempt) => (
                              <span
                                className="nfAttemptChip"
                                key={attempt.attemptNumber}
                                title={`Oportunidad ${attempt.attemptNumber}`}
                              >
                                {attempt.nota}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">Sin notas</span>
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

        .nfAttemptsEditor,
        .nfAttemptsRead {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .nfAttemptEditor {
          display: grid;
          gap: 3px;
          width: 48px;
          color: var(--muted);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
        }

        .nfAttemptChip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 30px;
          height: 30px;
          padding: 0 9px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--border2);
          color: var(--text);
          font-weight: 900;
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

          .nfAttemptsEditor,
          .nfAttemptsRead {
            gap: 6px;
          }

          .nfAttemptEditor {
            width: 42px;
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
