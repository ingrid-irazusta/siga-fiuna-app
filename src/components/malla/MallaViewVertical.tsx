"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MateriaCard from "./MateriaCard";
import { calcEstados, normText, parseRequisitos, isPlaceholderReq } from "./utils";
import { getSupabase } from "../../lib/supabaseClient";

const PROFILE_KEY = "fiuna_os_profile_v1";
const MALLA_CACHE_PREFIX = "fiuna_os_malla_cache_v1";
const LOCAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

interface MateriaItem {
  semestre: number;
  materia: string;
  requisitos: string[];
  key: string;
  requisitosKeys: string[];
}

function loadProfile(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

async function loadAprobadasFromDB(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("student_courses")
      .select("materia")
      .eq("user_id", userId);

    if (error) {
      console.error("Error loading aprobadas:", error);
      return new Set();
    }

    if (!Array.isArray(data)) return new Set();
    return new Set(
      data.map((x: { materia: string }) => normText(x.materia))
    );
  } catch (error) {
    console.error("Error in loadAprobadasFromDB:", error);
    return new Set();
  }
}

async function saveAprobadasToDB(userId: string, materia: string, approved: boolean): Promise<void> {
  if (!userId) return;
  try {
    const supabase = getSupabase();
    const materiaKey = normText(materia);

    if (approved) {
      // Insert
      const { error } = await supabase
        .from("student_courses")
        .insert({ user_id: userId, materia: materiaKey });
      if (error && !error.message.includes("duplicate")) {
        console.error("Error saving materia:", error);
      }
    } else {
      // Delete
      const { error } = await supabase
        .from("student_courses")
        .delete()
        .eq("user_id", userId)
        .eq("materia", materiaKey);
      if (error) {
        console.error("Error deleting materia:", error);
      }
    }
  } catch (error) {
    console.error("Error in saveAprobadasToDB:", error);
  }
}

function groupBySemestre(items: MateriaItem[]) {
  const m = new Map<number, MateriaItem[]>();
  for (const it of items) {
    const s = Number(it.semestre) || 0;
    if (s <= 0) continue;
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(it);
  }
  const sems = Array.from(m.keys()).sort((a, b) => a - b);
  return { map: m, sems };
}

export default function MallaViewVertical() {
  const [userId, setUserId] = useState<string>("");
  const [carrera, setCarrera] = useState<string>("");
  const [plan, setPlan] = useState<string>("2023");
  const [ci, setCi] = useState<string>("");

  useEffect(() => {
    try {
      const supabase = getSupabase();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user?.id) {
          setUserId(session.user.id);
        }
      });

      // Initial check
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) {
          setUserId(data.user.id);
        }
      });

      return () => {
        subscription?.unsubscribe();
      };
    } catch (error) {
      console.error("Error checking auth:", error);
    }
  }, []);

  useEffect(() => {
    const p = loadProfile();
    if (!p) return;
    if (typeof p.carrera === "string") setCarrera(p.carrera);
    if (p.malla === "2013" || p.malla === "2023") setPlan(p.malla);
    if (typeof p.ci === "string") setCi(p.ci);
  }, []);

  const [mode, setMode] = useState<"estricto" | "flexible">("estricto");
  const [blockPlaceholders, setBlockPlaceholders] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [items, setItems] = useState<MateriaItem[]>([]);

  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [radarKey, setRadarKey] = useState<string>("");
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());
  const [detailsItem, setDetailsItem] = useState<MateriaItem | null>(null);

  const [aprobadas, setAprobadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    loadAprobadasFromDB(userId).then((set) => setAprobadas(set));
  }, [userId]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!carrera || !plan) {
        setError("Elegí tu Carrera y Malla en Inicio.");
        setLoading(false);
        return;
      }

      setError("");
      setRadarKey("");

      const cacheKey = `${MALLA_CACHE_PREFIX}:${normText(carrera)}:${String(plan)}`;
      let cacheUsed = false;
      let shouldRevalidate = true;

      if (typeof window !== "undefined") {
        try {
          const rawCache = localStorage.getItem(cacheKey);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            const ts = Number(parsed?.ts) || 0;
            const cachedItems = Array.isArray(parsed?.items) ? parsed.items : null;
            if (cachedItems) {
              cacheUsed = true;
              if (Date.now() - ts < LOCAL_CACHE_TTL_MS) {
                shouldRevalidate = false;
                setItems(cachedItems);
                setLoading(false);
              } else {
                setItems(cachedItems);
              }
            }
          }
        } catch {}
      }

      if (!cacheUsed) setLoading(true);

      try {
        if (!shouldRevalidate && cacheUsed) return;

        const r = await fetch(
          `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}`
        );
        const data = await r.json().catch(() => null);

        if (!r.ok || !data?.ok) {
          throw new Error(data?.error || "No se pudo leer la BD_Malla");
        }

        const raw = Array.isArray(data.materias) ? data.materias : [];

        const prepared: MateriaItem[] = raw
          .map((m: any) => {
            const materia = String(m.materia || "").trim();
            const reqList = parseRequisitos(m.requisitos);
            const key = normText(materia);
            const requisitosKeys = reqList.map((r: string) => normText(r));
            return {
              semestre: Number(m.semestre) || 0,
              materia,
              requisitos: reqList,
              key,
              requisitosKeys,
            };
          })
          .filter((x: MateriaItem) => x.materia);

        if (!cancelled) setItems(prepared);

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(
              cacheKey,
              JSON.stringify({ ts: Date.now(), items: prepared })
            );
          } catch {}
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Error inesperado");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [carrera, plan]);

  const { map: semMap, sems } = useMemo(
    () => groupBySemestre(items),
    [items]
  );

  const estados = useMemo(() => {
    return calcEstados({
      items,
      aprobadasSet: aprobadas,
      strictMode: mode === "estricto",
      blockPlaceholders,
    });
  }, [items, aprobadas, mode, blockPlaceholders]);

  const radarKeys = useMemo(() => {
    const s = new Set<string>();
    if (!radarKey) return s;
    s.add(radarKey);
    const target = items.find((it) => it.key === radarKey);
    if (target) {
      for (const rk of target.requisitosKeys) s.add(rk);
    }
    return s;
  }, [radarKey, items]);

  const tryToggle = (it: MateriaItem) => {
    if (aprobadas.has(it.key)) {
      const next = new Set(aprobadas);
      next.delete(it.key);
      setAprobadas(next);
      saveAprobadasToDB(userId, it.materia, false);
      return;
    }

    if (mode === "flexible") {
      const next = new Set(aprobadas);
      next.add(it.key);
      setAprobadas(next);
      saveAprobadasToDB(userId, it.materia, true);
      return;
    }

    const missing: string[] = [];
    for (const rk of it.requisitosKeys) {
      if (!blockPlaceholders && isPlaceholderReq(rk)) continue;
      if (!aprobadas.has(rk)) missing.push(rk);
    }

    if (missing.length === 0) {
      const next = new Set(aprobadas);
      next.add(it.key);
      setAprobadas(next);
      saveAprobadasToDB(userId, it.materia, true);
      return;
    }

    showToast("⛔ Faltan requisitos");
    const flash = new Set(missing);
    setFlashKeys(flash);
    setTimeout(() => setFlashKeys(new Set()), 2600);
  };

  const openDetails = (it: MateriaItem) => {
    setDetailsItem(it);
    setRadarKey(it.key);
  };

  const closeDetails = () => {
    setDetailsItem(null);
    setRadarKey("");
  };

  return (
    <div className="grid">
      <div className="mallaToolbar">
        <div className="mallaToolbarRight">
          <button
            className="btn btnPrimary"
            onClick={() =>
              setMode((m) => (m === "estricto" ? "flexible" : "estricto"))
            }
          >
            Modo: {mode === "estricto" ? "Estricto" : "Flexible"}
          </button>

          <label
            className="checkMini"
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            <input
              type="checkbox"
              checked={blockPlaceholders}
              onChange={(e) => setBlockPlaceholders(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Placeholders bloquean
          </label>
        </div>
      </div>

      {toast ? (
        <div className="mallaToast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}

      {loading ? (
        <div className="muted">Cargando malla…</div>
      ) : error ? (
        <div className="mallaError">
          <div style={{ fontWeight: 900, marginBottom: 6 }}>
            No se pudo leer BD_Malla
          </div>
          <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        </div>
      ) : (
        <div
          className="mallaBoardV"
          onClick={closeDetails}
          aria-label="Malla por semestres (vertical)"
        >
          {sems.map((s) => (
            <div key={s} className="mallaSemestreV">
              <div className="mallaSemestreHeader">
                <div className="mallaSemestreTitleV">
                  {s}° semestre
                </div>
              </div>

              <div
                className="mallaGridV"
                onClick={(e) => e.stopPropagation()}
              >
                {(semMap.get(s) || []).map((it) => (
                  <MateriaCard
                    key={it.key}
                    item={it}
                    estado={estados.get(it.key)}
                    checked={aprobadas.has(it.key)}    
                    onToggle={tryToggle}
                    onOpen={openDetails}
                    radarActive={radarKeys.has(it.key)}
                    flash={flashKeys.has(it.key)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {detailsItem ? (
        <div
          className="mallaModalOverlay"
          onClick={closeDetails}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mallaModal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mallaModalHeader">
              <div style={{ fontWeight: 950 }}>
                {detailsItem.materia}
              </div>
              <button
                type="button"
                className="btn"
                onClick={closeDetails}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            {detailsItem.requisitos?.length ? (
              <div className="mallaReqList">
                <div className="muted" style={{ marginBottom: 8 }}>
                  Requisitos
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {detailsItem.requisitos.map((r) => (
                    <li key={r} style={{ marginBottom: 4 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="muted">
                Esta materia no tiene requisitos registrados.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
