"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SemestreColumn from "./SemestreColumn";
import { calcEstados, normText, parseRequisitos, isPlaceholderReq } from "./utils";
import { getSupabase } from "../../lib/supabaseClient";

const PROFILE_KEY = "fiuna_os_profile_v1";
const MALLA_CACHE_PREFIX = "fiuna_os_malla_cache_v1";
const LOCAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const CARRERAS: string[] = [
  "Ingeniería Geográfica y Ambiental",
  "Ingeniería Electromecánica",
  "Ingeniería Electrónica",
  "Ingeniería Mecánica",
  "Ingeniería Mecatrónica",
  "Ingeniería Industrial",
  "Ingeniería Civil",
];

interface MateriaItem {
  semestre: number;
  materia: string;
  requisitos: string[];
  key: string;
  requisitosKeys: string[];
}

async function loadProfileFromDB(userId: string): Promise<any | null> {
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

    return data && typeof data === "object" ? data : null;
  } catch (error) {
    console.error("Error in loadProfileFromDB:", error);
    return null;
  }
}

async function loadAprobadasFromDB(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("malla_approved_courses")
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

async function saveBatchAprobadasToDB(userId: string, aprobadas: Set<string>): Promise<void> {
  if (!userId) return;
  try {
    const supabase = getSupabase();

    // Primero, eliminar todas las aprobadas del usuario
    const { error: deleteError } = await supabase
      .from("malla_approved_courses")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting approved courses:", deleteError);
      return;
    }

    // Si hay materias aprobadas, insertarlas todas en lote
    if (aprobadas.size > 0) {
      const toInsert = Array.from(aprobadas).map((materia) => ({
        user_id: userId,
        materia,
      }));

      const { error: insertError } = await supabase
        .from("malla_approved_courses")
        .insert(toInsert);

      if (insertError) {
        console.error("Error inserting approved courses:", insertError);
        return;
      }
    }
  } catch (error) {
    console.error("Error in saveBatchAprobadasToDB:", error);
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

export default function MallaView() {
  const [userId, setUserId] = useState<string>("");
  const [carrera, setCarrera] = useState<string>(CARRERAS[0]);
  const [plan, setPlan] = useState<string>("2023");
  const [ci, setCi] = useState<string>("");
  const [intensificacion, setIntensificacion] = useState<string>("");

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
    let cancelled = false;

    const loadProfile = async () => {
      if (!userId) return;

      const p = await loadProfileFromDB(userId);
      if (cancelled) return;

      if (!p) return;
      if (CARRERAS.includes(p.carrera)) setCarrera(p.carrera);
      if (p.malla === "2013" || p.malla === "2023") setPlan(p.malla);
      if (typeof p.ci === "string") setCi(p.ci);
      if (typeof p.intensificacion === "string") setIntensificacion(p.intensificacion);
      else setIntensificacion("");
    };

    loadProfile();

    // Suscribirse a cambios en user_profiles para esta reacción a cambios en tiempo real
    try {
      const supabase = getSupabase();
      const subscription = supabase
        .channel(`public:user_profiles:user_id=eq.${userId}`)
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
              if (CARRERAS.includes(newProfile.carrera)) setCarrera(newProfile.carrera);
              if (newProfile.malla === "2013" || newProfile.malla === "2023") setPlan(newProfile.malla);
              if (typeof newProfile.ci === "string") setCi(newProfile.ci);
              if (typeof newProfile.intensificacion === "string") setIntensificacion(newProfile.intensificacion);
              else setIntensificacion("");
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
  const [isEditing, setIsEditing] = useState(false);
  const [editingAprobadas, setEditingAprobadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    loadAprobadasFromDB(userId).then((set) => {
      setAprobadas(set);
    });
  }, [userId]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError("");
      setRadarKey("");

      const usaIntensificacion =
        carrera === "Ingeniería Electrónica" && plan === "2023";

      const cacheKey = usaIntensificacion
        ? `${MALLA_CACHE_PREFIX}:${normText(carrera)}:${String(plan)}:${normText(intensificacion || "")}`
        : `${MALLA_CACHE_PREFIX}:${normText(carrera)}:${String(plan)}`;
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
        } catch { }
      }

      if (!cacheUsed) setLoading(true);

      try {
        if (!shouldRevalidate && cacheUsed) return;

        const url = usaIntensificacion
          ? `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}&intensificacion=${encodeURIComponent(intensificacion || "")}`
          : `/api/malla?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}`;

        const r = await fetch(url);
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
          } catch { }
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
  }, [carrera, plan, intensificacion]);

  const { map: semMap, sems } = useMemo(
    () => groupBySemestre(items),
    [items]
  );

  const activeAprobadas = isEditing ? editingAprobadas : aprobadas;

  const estados = useMemo(() => {
    return calcEstados({
      items,
      aprobadasSet: activeAprobadas,
      strictMode: mode === "estricto",
      blockPlaceholders,
    });
  }, [items, activeAprobadas, mode, blockPlaceholders]);

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

  const totals = useMemo(() => {
    const shown = items.filter((x) => (Number(x.semestre) || 0) > 0);
    const total = shown.length;
    let ok = 0;
    for (const it of shown) if (activeAprobadas.has(it.key)) ok++;
    return { total, ok };
  }, [items, activeAprobadas]);



  const tryToggle = (it: MateriaItem) => {
    if (!isEditing) return;

    if (editingAprobadas.has(it.key)) {
      const next = new Set(editingAprobadas);
      next.delete(it.key);
      setEditingAprobadas(next);
      return;
    }

    if (mode === "flexible") {
      const next = new Set(editingAprobadas);
      next.add(it.key);
      setEditingAprobadas(next);
      return;
    }

    const missing: string[] = [];
    for (const rk of it.requisitosKeys) {
      if (!blockPlaceholders && isPlaceholderReq(rk)) continue;
      if (!editingAprobadas.has(rk)) missing.push(rk);
    }

    if (missing.length === 0) {
      const next = new Set(editingAprobadas);
      next.add(it.key);
      setEditingAprobadas(next);
      return;
    }

    showToast("⛔ Faltan requisitos");
    const flash = new Set(missing);
    setFlashKeys(flash);
    setTimeout(() => setFlashKeys(new Set()), 2600);
  };

  const handleStartEditing = () => {
    setEditingAprobadas(new Set(aprobadas));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditingAprobadas(new Set());
    setIsEditing(false);
  };

  const handleSaveChanges = async () => {
    try {
      await saveBatchAprobadasToDB(userId, editingAprobadas);
      setAprobadas(new Set(editingAprobadas));
      setIsEditing(false);
      setEditingAprobadas(new Set());
      showToast("✓ Cambios guardados");
    } catch (error) {
      console.error("Error al guardar:", error);
    }
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
          {!isEditing ? (
            <button
              className="btn btnPrimary"
              onClick={handleStartEditing}
            >
              ✏️ Editar malla
            </button>
          ) : (
            <>
              <button
                className="btn btnSuccess"
                onClick={handleSaveChanges}
              >
                💾 Guardar cambios
              </button>
              <button
                className="btn btnSecondary"
                onClick={handleCancelEdit}
              >
                Cancelar
              </button>
            </>
          )}
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
          className="mallaBoard"
          onClick={closeDetails}
          aria-label="Malla por semestres"
        >
          {sems.map((s) => (
            <SemestreColumn
              key={s}
              semestre={s}
              items={semMap.get(s) || []}
              estados={estados}
              aprobadasSet={activeAprobadas}
              onToggle={tryToggle}
              onOpen={openDetails}
              radarKeys={radarKeys}
              flashKeys={flashKeys}
            />
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
