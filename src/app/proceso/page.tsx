"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "../../components/Card";
import SimuladorNotas from "../../components/SimuladorNotas";
import ProcesoTable from "../../components/ProcesoTable";
import { getSupabase } from "@/lib/supabaseClient";
import BigModal from "../proceso/components/BigModal";
import InfoTip from "../proceso/components/InfoTip";

// ============= TYPES & INTERFACES =============

interface ChildRow {
  rid: string;
  label: string;
  peso: number;
  pct: number;
}

interface Row {
  rid: string;
  label: string;
  peso: number;
  min: number;
  pct: number;
  isGroup?: boolean;
  children?: ChildRow[];
}

interface CourseItem {
  id: string;
  nombre: string;
  semestre: number;
  withLab: boolean;
  rows: Row[];
  realRecuOn: boolean;
  realRecuPct: number;
  realPreferExo: boolean;
  realFinalPanelOpen: boolean;
  realFinalOn: boolean;
  realFinalPct: number;
  realUseRecuForFinal: boolean;
  realThirdAttempt: boolean;
  realAction: "rendir" | "recu" | "final" | "exo";
  realExamPct: number;
}

interface Course {
  mat?: string;
  sem?: number;
}

interface ProcesoData {
  items: CourseItem[];
}

interface ExoneracionResult {
  ok: boolean;
  nota: number | null;
}

interface RecuTarget {
  rid: string;
  label: string;
  pts: number;
}

interface GroupTotals {
  pesoGrupo: number;
  totalGrupo: number;
  pctGrupo: number;
}

interface Totals {
  materias: number;
  hab: number;
}

interface ScoreRowProps {
  label: string;
  max: number;
  value: number;
  onChange: (value: string) => void;
}

// ============= CONSTANTS =============

const COURSES_KEY = "fiuna_os_current_courses_v1";
const PROCESS_KEY = "fiuna_os_proceso_v1";
const DEFAULT_ITEMS: CourseItem[] = [];
function normalizeSemestre(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value ?? "").trim().toLowerCase();

  if (!raw) return 1;

  const match = raw.match(/\d+/);
  if (match) return Number(match[0]);

  if (
    raw.includes("optativa") ||
    raw.includes("complementaria") ||
    raw.includes("ciclo profesional") ||
    raw.includes("profesional")
  ) {
    return 5;
  }

  return 1;
}

import {
  normText,
  clampNum,
  cloneRowsDeep,
  calcProcessTotal,
  calcPesoTotal,
  calcCumpleMinimos,
  groupTotals,
  calcTotalConRecu,
  recuTarget,
  calcExoneracion,
  calcParcialPts,
  calcNotaFinalFIUNA,
  createEmptyRows,
  rowTotalOf as utilRowTotalOf,
} from "@/lib/procesoUtils";

function rowTotalRaw(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return (peso * pct) / 100;
}

function rowTotalOf(r: Row | ChildRow): number {
  const peso = clampNum((r as any)?.peso, 0, 999);
  const pct = clampNum((r as any)?.pct, 0, 100);
  return (peso * pct) / 100;
}

async function loadCourses(userId: string): Promise<Course[]> {
  try {
    const supabase = getSupabase();
    const { data: coursesData, error } = await supabase
      .from("student_courses")
      .select("semestre, materia")
      .eq("user_id", userId)
      .order("semestre", { ascending: true });

    if (error) {
      console.error("Error loading student_courses:", error);
      return [];
    }

    return (coursesData || []).map((c) => ({
      mat: c.materia,
      sem: normalizeSemestre(c.semestre),
    }));
  } catch {
    return [];
  }
}

async function loadProceso(userId: string): Promise<ProcesoData> {
  try {
    const supabase = getSupabase();
    const { data: processesData } = await supabase
      .from("student_processes")
      .select("materia, process_data")
      .eq("user_id", userId);

    const items: CourseItem[] = (processesData || []).map((p) => p.process_data).filter(Boolean);
    return { items };
  } catch {
    return { items: DEFAULT_ITEMS };
  }
}

async function saveProceso(userId: string, data: ProcesoData): Promise<void> {
  try {
    const supabase = getSupabase();
    // Delete existing
    await supabase.from("student_processes").delete().eq("user_id", userId);

    // Insert new
    if (data.items.length) {
      const inserts = data.items.map((item) => ({
        user_id: userId,
        materia: normText(item.nombre),
        process_data: item,
        updated_at: new Date().toISOString(),
      }));
      await supabase.from("student_processes").insert(inserts);
    }
  } catch (e) {
    console.error("Error saving proceso:", e);
  }
}

function makeId(nombre: string, semestre: number): string {
  return `${normText(nombre)}-${semestre}`;
}

function mergeCoursesIntoItems(courses: Course[], existingItems: CourseItem[]): CourseItem[] {
  const cleaned = (courses || [])
    .map((c) => ({
      nombre: String(c?.mat || "").trim(),
      semestre: normalizeSemestre(c?.sem),
    }))
    .filter((c) => c.nombre);

  if (!cleaned.length) return existingItems || [];

  const byId = new Map(existingItems.map((it) => [it.id, it]));

  const next = cleaned.map((c) => {
    const id = makeId(c.nombre, c.semestre);
    const prev = byId.get(id);
    return (
      prev || {
        id,
        nombre: c.nombre,
        semestre: c.semestre,
        withLab: false,
        rows: defaultRows(false),
        realRecuOn: false,
        realRecuPct: 0,
        realPreferExo: false,
        realFinalPanelOpen: false,
        realFinalOn: false,
        realFinalPct: 0,
        realUseRecuForFinal: true,
        realThirdAttempt: false,
        realAction: "rendir" as const,
        realExamPct: 0,
      }
    );
  });

  next.sort(
    (a, b) =>
      (Number(a.semestre) || 999) - (Number(b.semestre) || 999) ||
      String(a.nombre).localeCompare(String(b.nombre))
  );
  return next;
}

function defaultRows(withLab: boolean): Row[] {
  const base: Row[] = [
    { rid: "p1", label: "Parcial 1", peso: 0, min: 0, pct: 0 },
    { rid: "p2", label: "Parcial 2", peso: 0, min: 0, pct: 0 },
    {
      rid: "g_talleres",
      isGroup: true,
      label: "Talleres",
      peso: 0,
      min: 0,
      pct: 0,
      children: [
        { rid: "t1", label: "Taller 1", peso: 0, pct: 0 },
        { rid: "t2", label: "Taller 2", peso: 0, pct: 0 },
      ],
    },
  ];

  if (withLab) {
    base.push({
      rid: "g_labs",
      isGroup: true,
      label: "Laboratorios",
      peso: 0,
      min: 0,
      pct: 0,
      children: [{ rid: "lab1", label: "Lab 1", peso: 0, pct: 0 }],
    });
  }

  return base;
}

function migrateItemIfNeeded(it: any): CourseItem {
  if (it && Array.isArray(it.rows)) {
    return {
      ...it,
      realRecuOn: !!it?.realRecuOn,
      realRecuPct: it?.realRecuPct ?? 0,
      realPreferExo: !!it?.realPreferExo,
      realFinalOn: !!it?.realFinalOn,
      realFinalPct: it?.realFinalPct ?? 0,
      realUseRecuForFinal: it?.realUseRecuForFinal ?? true,
      realThirdAttempt: !!it?.realThirdAttempt,
      realAction: it?.realAction ?? "rendir",
      realExamPct: it?.realExamPct ?? 0,
      realFinalPanelOpen: it?.realFinalPanelOpen ?? false,
    };
  }

  const withLab = !!it?.withLab;
  const def = defaultRows(withLab);

  const scores = it?.scores || {};
  const mins = it?.mins || {};

  const nextRows = def.map((r) => {
    const peso = clampNum(r.peso, 0, 999);
    const totalOld = clampNum(scores?.[r.rid], 0, peso);
    const pct = peso ? Math.round((totalOld / peso) * 100) : 0;

    return {
      ...r,
      min: clampNum(mins?.[r.rid], 0, 999),
      pct,
    };
  });

  return {
    ...it,
    withLab,
    rows: nextRows,
    realRecuOn: !!it?.realRecuOn,
    realRecuPct: it?.realRecuPct ?? 0,
    realPreferExo: !!it?.realPreferExo,
    realFinalOn: !!it?.realFinalOn,
    realFinalPct: it?.realFinalPct ?? 0,
    realUseRecuForFinal: it?.realUseRecuForFinal ?? true,
  };
}

// ============= MAIN COMPONENT =============

export default function ProcesoPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [simRowsById, setSimRowsById] = useState<Record<string, Row[]>>({});
  const [items, setItems] = useState<CourseItem[]>(DEFAULT_ITEMS);
  const [recuPctByItem, setRecuPctByItem] = useState<Record<string, number>>({});
  const [simOpenId, setSimOpenId] = useState<string | null>(null);
  const [simRecuPctByItem, setSimRecuPctByItem] = useState<Record<string, number>>({});
  const [simFinalPctByItem, setSimFinalPctByItem] = useState<Record<string, number>>({});
  const [simUseRecuForFinalByItem, setSimUseRecuForFinalByItem] = useState<Record<string, boolean>>({});
  const [didLoadProceso, setDidLoadProceso] = useState<boolean>(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [editingItems, setEditingItems] = useState<Record<string, boolean>>({});
  const [draftRowsById, setDraftRowsById] = useState<Record<string, Row[]>>({});

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.push("/auth");
        return;
      }

      const uid = data.session.user.id;
      setUserId(uid);

      const d = await loadProceso(uid);
      const courses = await loadCourses(uid);
      const merged = mergeCoursesIntoItems(courses, d.items).map(migrateItemIfNeeded);
      setItems(merged);
      setDidLoadProceso(true);
      setIsLoading(false);
    };

    load();
  }, [router]);

  useEffect(() => {
    if (!didLoadProceso || !userId) return;
    saveProceso(userId, { items });
  }, [didLoadProceso, items, userId]);

  const syncFromInicio = async () => {
    if (!userId) return;
    const courses = await loadCourses(userId);
    setItems((prev) => mergeCoursesIntoItems(courses, prev).map(migrateItemIfNeeded));
  };

  const updateItem = (id: string, patch: Partial<CourseItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const updateRow = (id: string, rid: string, patch: Partial<Row>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const rows = Array.isArray(it.rows) ? it.rows : [];
        const nextRows = rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r));
        return { ...it, rows: nextRows };
      })
    );
  };

  const addRow = (id: string) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[id] || []);
      const rid = `r:${Date.now()}`;

      return {
        ...prev,
        [id]: [
          ...rows,
          { rid, label: "", peso: 0, min: 0, pct: 0 },
        ],
      };
    });
  };

  const removeRow = (id: string, rid: string) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[id] || []);
      return {
        ...prev,
        [id]: rows.filter((r) => r.rid !== rid),
      };
    });
  };

  const addGroup = (id: string) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[id] || []);
      const gid = `g:${Date.now()}`;
      const c1 = `c:${Date.now()}-1`;
      const c2 = `c:${Date.now()}-2`;

      return {
        ...prev,
        [id]: [
          ...rows,
          {
            rid: gid,
            isGroup: true,
            label: "",
            peso: 0,
            min: 0,
            pct: 0,
            children: [
              { rid: c1, label: "", peso: 0, pct: 0 },
              { rid: c2, label: "", peso: 0, pct: 0 },
            ],
          },
        ],
      };
    });
  };

  const addSubRow = (id: string, groupRid: string) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[id] || []);

      return {
        ...prev,
        [id]: rows.map((r) => {
          if (r.rid !== groupRid) return r;
          const kids = Array.isArray(r.children) ? r.children : [];
          const rid = `c:${Date.now()}`;
          return {
            ...r,
            children: [...kids, { rid, label: "", peso: 0, pct: 0 }],
          };
        }),
      };
    });
  };

  const removeSubRow = (id: string, groupRid: string, childRid: string) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[id] || []);

      return {
        ...prev,
        [id]: rows.map((r) => {
          if (r.rid !== groupRid) return r;
          const kids = Array.isArray(r.children) ? r.children : [];
          return {
            ...r,
            children: kids.filter((k) => k.rid !== childRid),
          };
        }),
      };
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const totals: Totals = useMemo(() => {
    let hab = 0;
    for (const it of items) {
      const t = calcProcessTotal(it.rows);
      if (t >= 50) hab++;
    }
    return { materias: items.length, hab };
  }, [items]);

  const cloneRowsDeep = (rows: Row[]): Row[] => {
    const arr = Array.isArray(rows) ? rows : [];
    return arr.map((r) => ({
      ...r,
      children: Array.isArray(r.children) ? r.children.map((c) => ({ ...c })) : undefined,
    }));
  };
  const startEditing = (it: CourseItem) => {
    setDraftRowsById((prev) => ({
      ...prev,
      [it.id]: cloneRowsDeep(it.rows),
    }));
    setEditingItems((prev) => ({
      ...prev,
      [it.id]: true,
    }));
  };

  const cancelEditing = (id: string) => {
    setEditingItems((prev) => ({
      ...prev,
      [id]: false,
    }));
    setDraftRowsById((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const saveEditing = (id: string) => {
    const draft = draftRowsById[id];
    if (!draft) return;

    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, rows: cloneRowsDeep(draft) } : it))
    );

    setEditingItems((prev) => ({
      ...prev,
      [id]: false,
    }));

    setDraftRowsById((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const updateDraftRow = (itemId: string, rid: string, patch: Partial<Row>) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[itemId] || []);
      return {
        ...prev,
        [itemId]: rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r)),
      };
    });
  };

  const updateDraftChild = (
    itemId: string,
    groupRid: string,
    childRid: string,
    patch: Partial<ChildRow>
  ) => {
    setDraftRowsById((prev) => {
      const rows = cloneRowsDeep(prev[itemId] || []);
      return {
        ...prev,
        [itemId]: rows.map((r) =>
          r.rid !== groupRid
            ? r
            : {
              ...r,
              children: (r.children || []).map((c) =>
                c.rid === childRid ? { ...c, ...patch } : c
              ),
            }
        ),
      };
    });
  };

  const updateSimPct = (itemId: string, rid: string, pctValue: number) => {
    setSimRowsById((prev) => {
      const base = cloneRowsDeep(prev[itemId] || []);
      const next = base.map((r) => {
        if (r.rid === rid) return { ...r, pct: pctValue };
        if (Array.isArray(r.children) && r.children.length > 0) {
          return {
            ...r,
            children: r.children.map((c) => (c.rid === rid ? { ...c, pct: pctValue } : c)),
          };
        }
        return r;
      });
      return { ...prev, [itemId]: next };
    });
  };

  const openSim = (it: CourseItem) => {
    setSimRowsById((prev) => ({
      ...prev,
      [it.id]: cloneRowsDeep(it.rows),
    }));
    setSimOpenId(it.id);
  };


  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p>Cargando...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Card title="No hay materias">
          <p>No se encontraron materias registradas.</p>
          <button
            className="btn"
            onClick={syncFromInicio}
            style={{ marginTop: 12 }}
          >
            Sincronizar desde Inicio
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {items.map((it) => {
        const withLab = !!it.withLab;
        const isEditing = !!editingItems[it.id];
        const rows = isEditing
          ? draftRowsById[it.id] || cloneRowsDeep(it.rows)
          : Array.isArray(it.rows)
            ? it.rows
            : [];

        const total = calcProcessTotal(rows);

        const pesoTotal = calcPesoTotal(rows);
        const pesoOk = pesoTotal === 100;

        const p1 =
          rows.find((x) => x.rid === "p1") ||
          rows.find((x) => normText(x?.label).includes("parcial 1"));

        const p2 =
          rows.find((x) => x.rid === "p2") ||
          rows.find((x) => normText(x?.label).includes("parcial 2"));

        const p1pct = clampNum(p1?.pct ?? 0, 0, 100);
        const p2pct = clampNum(p2?.pct ?? 0, 0, 100);

        const cumpleMinimos = calcCumpleMinimos(rows);
        const validoParaReglas = pesoOk && cumpleMinimos;
        const recuperatorio = validoParaReglas && (total >= 30 || p1pct >= 40 || p2pct >= 40);
        const hab = validoParaReglas && total >= 50;

        const ex = validoParaReglas
          ? calcExoneracion(it.semestre, total)
          : { ok: false, nota: null };

        const sfMinStatus = !pesoOk ? "-" : cumpleMinimos ? "SI" : "NO";
        const sfRecuStatus = !validoParaReglas ? "-" : recuperatorio ? "SI" : "NO";
        const sfFirmaStatus = !validoParaReglas ? "-" : hab ? "SI" : "NO";
        const sfExoStatus = !validoParaReglas ? "-" : ex.ok ? "SI" : "NO";

        const sfMinInfo =
          "Los mínimos son condiciones obligatorias. " +
          "Si alguno no se cumple, no habilita Recuperatorio, Firma ni Exoneración, " +
          "independientemente del puntaje total.";

        const sfRecuInfo = "Min: 30 pts de Proceso o ≥40% en un parcial.";

        const sfFirmaInfo =
          "Requisito: alcanzar al menos 50 puntos en el Total de Proceso. " +
          "Se evalúa únicamente si se cumplieron los mínimos.";

        const sfExoInfo =
          it.semestre <= 4
            ? "Min: 71 pts (Ciclo básico). Si con el recuperatorio el total alcanza exoneración, puede exonerar en el segundo final."
            : "Min: 81 pts (Profesional). Si con el recuperatorio el total alcanza exoneración, puede exonerar en el segundo final.";

        function sfPillStyle(v: string): React.CSSProperties {
          const base: React.CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            padding: "4px 10px",
            borderRadius: 999,
            fontWeight: 950,
            fontSize: 12,
            border: "1px solid rgba(2,6,23,0.12)",
            background: "rgba(2,6,23,0.04)",
            color: "var(--muted)",
          };

          if (v === "SI") {
            return {
              ...base,
              border: "1px solid var(--success)",
              background: "var(--success2)",
              color: "var(--success)",
            };
          }

          if (v === "NO") {
            return {
              ...base,
              border: "1px solid rgba(220,38,38,0.25)",
              background: "rgba(220,38,38,0.10)",
              color: "rgba(220,38,38,0.95)",
            };
          }

          return base;
        }

        const recuPct = clampNum(recuPctByItem[it.id] ?? 60, 0, 100);
        const target = recuTarget(rows);
        const totalConRecu = calcTotalConRecu(rows, recuPct);
        const exConRecu = validoParaReglas
          ? calcExoneracion(it.semestre, totalConRecu)
          : { ok: false, nota: null };

        const realRecuOn = !!it.realRecuOn;
        const realRecuPct = clampNum(it.realRecuPct ?? 0, 0, 100);
        const realCanRecu = validoParaReglas && recuperatorio;

        const realTotalConRecu =
          realRecuOn && realCanRecu ? calcTotalConRecu(rows, realRecuPct) : null;

        const realExConRecu =
          realRecuOn && realCanRecu
            ? calcExoneracion(it.semestre, realTotalConRecu!)
            : { ok: false, nota: null };

        const realExPossible = realRecuOn ? (realExConRecu.ok ? realExConRecu : ex) : ex;

        const realProcesoParaFinal =
          it.realUseRecuForFinal && realTotalConRecu != null ? realTotalConRecu : total;

        const realHasFirma = validoParaReglas && realProcesoParaFinal >= 50;

        const realFinalOn = !!it.realFinalOn;
        const realExamPct = clampNum(it.realExamPct ?? 0, 0, 100);

        const realPreferExo = !!it.realPreferExo;
        const realNotaFinal =
          realPreferExo && realExPossible.ok
            ? realExPossible.nota
            : realHasFirma && realFinalOn
              ? calcNotaFinalFIUNA(realProcesoParaFinal, realExamPct)
              : null;

        const realCanExonerar = validoParaReglas && !it.realThirdAttempt && !!realExPossible.ok;

        const realFinalPanelOpen = !!it.realFinalPanelOpen;

        const isExpanded = !!expandedItems[it.id];

        return (
          <Card
            key={it.id}
            title={
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  cursor: "pointer",
                  userSelect: "none"
                }}
                onClick={() => setExpandedItems(prev => ({ ...prev, [it.id]: !isExpanded }))}
              >
                <span style={{ fontSize: 18 }}>{isExpanded ? "▼" : "▶"}</span>
                <span style={{ fontWeight: 950 }}>{it.nombre}</span>
                <span className="pill">
                  Semestre: <span className="kbd">{it.semestre}</span>
                </span>
              </div>
            }
          >
            {isExpanded && (
              <>
                <BigModal
                  open={simOpenId === it.id}
                  title={`🧪 Simulador — ${it.nombre}`}
                  onClose={() => setSimOpenId(null)}
                >
                  <SimuladorNotas
                    title={`🧪 Simulador — ${it.nombre}`}
                    rows={simRowsById[it.id] || cloneRowsDeep(it.rows)}
                    onRowsChange={(nextRows) =>
                      setSimRowsById((prev) => ({ ...prev, [it.id]: nextRows }))
                    }
                    recuPct={simRecuPctByItem[it.id] ?? 60}
                    onRecuPctChange={(value) =>
                      setSimRecuPctByItem((prev) => ({ ...prev, [it.id]: value }))
                    }
                    finalPct={simFinalPctByItem[it.id] ?? 60}
                    onFinalPctChange={(value) =>
                      setSimFinalPctByItem((prev) => ({ ...prev, [it.id]: value }))
                    }
                    useRecuForFinal={!!simUseRecuForFinalByItem[it.id]}
                    onUseRecuForFinalChange={(value) =>
                      setSimUseRecuForFinalByItem((prev) => ({ ...prev, [it.id]: value }))
                    }
                    semestre={it.semestre}
                    mode="process"
                  />
                </BigModal>

                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    className="procTwoCards"
                    style={{
                      display: "grid",
                      gap: 12,
                      alignItems: "stretch",
                      minWidth: 0,
                      maxWidth: "100%",
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          padding: "10px 12px",
                          background: "var(--primary2)",
                          borderBottom: "1px solid var(--border)",
                          fontWeight: 950,
                          color: "var(--primary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          minHeight: 44,
                        }}
                      >

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span>📊 PROCESO DE EVALUACIÓN</span>

                          {!isEditing ? (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => startEditing(it)}
                              style={{
                                borderRadius: 999,
                                fontWeight: 950,
                                fontSize: 12,
                                padding: "6px 12px",
                                height: 32,
                              }}
                              title="Editar proceso"
                            >
                              ✏️ Editar
                            </button>
                          ) : (
                            <>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => saveEditing(it.id)}
                                style={{
                                  borderRadius: 999,
                                  fontWeight: 950,
                                  fontSize: 12,
                                  padding: "6px 12px",
                                  height: 32,
                                }}
                                title="Guardar proceso"
                              >
                                💾 Guardar
                              </button>

                              <button
                                className="btn"
                                type="button"
                                onClick={() => cancelEditing(it.id)}
                                style={{
                                  borderRadius: 999,
                                  fontWeight: 950,
                                  fontSize: 12,
                                  padding: "6px 12px",
                                  height: 32,
                                }}
                                title="Cancelar edición"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                        </div>

                        <button
                          className="btn procHeaderGhostBtn simBtnDesktop"
                          onClick={() => openSim(it)}
                          style={{
                            borderRadius: 999,
                            fontWeight: 950,
                            fontSize: 12,
                            padding: "6px 12px",
                            height: 32,
                          }}
                          type="button"
                        >
                          🧪 Abrir simulador
                        </button>
                      </div>

                      {!pesoOk && (
                        <div
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid var(--border)",
                            background: "rgba(220,38,38,0.10)",
                            color: "rgba(220,38,38,0.95)",
                            fontWeight: 900,
                            fontSize: 12,
                          }}
                        >
                          ⚠️ La suma de PESO debe ser 100. Ahora es: {pesoTotal}
                        </div>
                      )}

                      <div
                        className="procTableWrap procEvalWrap"
                        style={{
                          padding: 8,
                          overflowX: "auto",
                          WebkitOverflowScrolling: "touch",
                          touchAction: "pan-x",
                          flex: 1,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              tableLayout: "fixed",
                            }}
                          >
                            <colgroup>
                              <col style={{ width: 60 }} />
                              <col style={{ width: 50 }} />
                              <col style={{ width: 50 }} />
                              <col style={{ width: 50 }} />
                              <col style={{ width: 40 }} />
                              <col style={{ width: 40 }} />
                            </colgroup>

                            <thead>
                              <tr style={{ fontSize: 12, color: "var(--muted)" }}>
                                <th
                                  style={{
                                    padding: "4px 6px",
                                    whiteSpace: "nowrap",
                                    textAlign: "left",
                                  }}
                                >
                                  INSTANCIA
                                </th>
                                <th
                                  style={{
                                    padding: "4px 6px",
                                    whiteSpace: "nowrap",
                                    textAlign: "center",
                                  }}
                                >
                                  PESO
                                </th>
                                <th
                                  style={{
                                    padding: "4px 6px",
                                    whiteSpace: "nowrap",
                                    textAlign: "center",
                                  }}
                                >
                                  MIN REQ.
                                </th>
                                <th
                                  style={{
                                    padding: "4px 6px",
                                    whiteSpace: "nowrap",
                                    textAlign: "center",
                                  }}
                                >
                                  %HECHO
                                </th>
                                <th
                                  style={{
                                    padding: "4px 6px",
                                    whiteSpace: "nowrap",
                                    textAlign: "center",
                                  }}
                                >
                                  TOTAL
                                </th>
                                <th style={{ padding: "4px 6px", textAlign: "center" }} />
                              </tr>
                            </thead>

                            <tbody>
                              {rows.flatMap((r) => {
                                const isP = r.rid === "p1" || r.rid === "p2";
                                const isGroup = !!r.isGroup;

                                const hasKids =
                                  Array.isArray(r.children) && r.children.length > 0;
                                const g = hasKids ? groupTotals(r) : null;
                                const totalRow =
                                  isGroup && hasKids ? g!.totalGrupo : rowTotalOf(r);

                                const groupRow = (
                                  <tr
                                    key={r.rid}
                                    style={{
                                      borderTop: "1px solid rgba(2,6,23,0.08)",
                                      background: "transparent",
                                    }}
                                  >
                                    <td style={{ padding: "4px 6px", textAlign: "left" }}>
                                      {isP || !isEditing ? (
                                        <div style={{ fontWeight: 900, padding: "4px 6px" }}>
                                          {String(r?.label ?? "")}
                                        </div>
                                      ) : (
                                        <input
                                          className="input numMini"
                                          value={String(r?.label ?? "")}
                                          onChange={(e) =>
                                            updateDraftRow(it.id, r.rid, { label: e.target.value })
                                          }
                                          style={{
                                            width: "100%",
                                            padding: "4px 6px",
                                            fontWeight: 900,
                                          }}
                                        />
                                      )}
                                    </td>

                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                      <input
                                        className="input numMini"
                                        type="number"
                                        min={0}
                                        max={999}
                                        value={String(
                                          isGroup && hasKids
                                            ? g!.pesoGrupo
                                            : r?.peso ?? 0
                                        )}

                                        disabled={!isEditing || (isGroup && hasKids)}
                                        onChange={(e) => {
                                          if (!isEditing || (isGroup && hasKids)) return;
                                          updateDraftRow(it.id, r.rid, { peso: clampNum(e.target.value, 0, 999) });
                                        }}
                                        style={{
                                          width: 72,
                                          minWidth: 72,
                                          maxWidth: 72,
                                          padding: "4px 6px",
                                          fontWeight: 800,
                                          textAlign: "center",
                                          opacity: isGroup && hasKids ? 0.7 : 1,
                                          cursor: isGroup && hasKids ? "not-allowed" : "text",
                                        }}
                                      />
                                    </td>

                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                      {isP ? (
                                        <span style={{ opacity: 0.6 }}> </span>
                                      ) : (
                                        <input
                                          className="input numMini"
                                          type="number"
                                          min={0}
                                          max={999}
                                          value={String(r?.min ?? 0)}
                                          disabled={!isEditing}
                                          onChange={(e) =>
                                            updateDraftRow(it.id, r.rid, { min: clampNum(e.target.value, 0, 999) })
                                          }
                                          style={{
                                            width: 72,
                                            minWidth: 72,
                                            maxWidth: 72,
                                            padding: "4px 6px",
                                            fontWeight: 800,
                                            textAlign: "center",
                                          }}
                                        />
                                      )}
                                    </td>

                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                      <input
                                        className="input numMini"
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={String(
                                          isGroup && hasKids ? g!.pctGrupo : r?.pct ?? 0
                                        )}

                                        disabled={!isEditing || (isGroup && hasKids)}
                                        onChange={(e) => {
                                          if (!isEditing || (isGroup && hasKids)) return;
                                          updateDraftRow(it.id, r.rid, { pct: clampNum(e.target.value, 0, 100) });
                                        }}
                                        style={{
                                          width: 72,
                                          minWidth: 72,
                                          maxWidth: 72,
                                          padding: "4px 6px",
                                          fontWeight: 800,
                                          textAlign: "center",
                                          opacity: isGroup && hasKids ? 0.7 : 1,
                                          cursor: isGroup && hasKids ? "not-allowed" : "text",
                                        }}
                                      />
                                    </td>

                                    <td
                                      style={{
                                        padding: "4px 6px",
                                        fontWeight: 950,
                                        textAlign: "center",
                                      }}
                                    >
                                      {totalRow}
                                    </td>

                                    <td
                                      style={{
                                        padding: "4px 6px",
                                        textAlign: "center",
                                        width: 44,
                                        minWidth: 44,
                                      }}
                                    >
                                      {!isEditing ? (
                                        <span />
                                      ) : isP ? (
                                        <span />
                                      ) : isGroup ? (
                                        hasKids ? (
                                          <button
                                            className="btn"
                                            onClick={() => addSubRow(it.id, r.rid)}
                                            style={{
                                              width: 34,
                                              height: 34,
                                              padding: 0,
                                              borderRadius: 999,
                                            }}
                                            title="Agregar subfila"
                                          >
                                            +
                                          </button>
                                        ) : (
                                          <button
                                            className="btn"
                                            onClick={() => removeRow(it.id, r.rid)}
                                            style={{
                                              width: 34,
                                              height: 34,
                                              padding: 0,
                                              borderRadius: 999,
                                            }}
                                            title="Eliminar grupo"
                                          >
                                            ✕
                                          </button>
                                        )
                                      ) : (
                                        <button
                                          className="btn"
                                          onClick={() => removeRow(it.id, r.rid)}
                                          style={{
                                            width: 34,
                                            height: 34,
                                            padding: 0,
                                            borderRadius: 999,
                                          }}
                                          title="Eliminar fila"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );

                                if (!isGroup) return [groupRow];

                                const kids = Array.isArray(r.children) ? r.children : [];
                                const kidsRows = kids.map((k) => {
                                  const kidTotal = rowTotalOf(k);
                                  return (
                                    <tr
                                      key={`${r.rid}__${k.rid}`}
                                      style={{
                                        borderTop: "1px solid rgba(2,6,23,0.06)",
                                        background: "rgba(2,6,23,0.03)",
                                        fontSize: 12,
                                      }}
                                    >
                                      <td style={{ padding: "4px 6px", textAlign: "left" }}>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 20,
                                          }}
                                        >
                                          <span className="muted"> </span>
                                          <input
                                            className="input numMini"
                                            value={String(k?.label ?? "")}
                                            disabled={!isEditing}
                                            onChange={(e) => {
                                              updateDraftChild(it.id, r.rid, k.rid, {
                                                label: e.target.value,
                                              });
                                            }}
                                            style={{
                                              width: "100%",
                                              padding: "4px 6px",
                                              fontWeight: 800,
                                              opacity: !isEditing ? 0.7 : 1,
                                              cursor: !isEditing ? "not-allowed" : "text",
                                            }}
                                          />
                                        </div>
                                      </td>

                                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                        <input
                                          className="input numMini"
                                          type="number"
                                          min={0}
                                          max={999}
                                          value={String(k?.peso ?? 0)}
                                          disabled={!isEditing}
                                          onChange={(e) => {
                                            updateDraftChild(it.id, r.rid, k.rid, {
                                              peso: clampNum(e.target.value, 0, 999),
                                            });
                                          }}
                                          style={{
                                            width: 72,
                                            minWidth: 72,
                                            maxWidth: 72,
                                            padding: "4px 6px",
                                            fontWeight: 800,
                                            textAlign: "center",
                                            opacity: !isEditing ? 0.7 : 1,
                                            cursor: !isEditing ? "not-allowed" : "text",
                                          }}
                                        />
                                      </td>

                                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                        <span className="muted" style={{ fontSize: 12 }}></span>
                                      </td>

                                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                        <input
                                          className="input numMini"
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={String(k?.pct ?? 0)}
                                          disabled={!isEditing}
                                          onChange={(e) => {
                                            updateDraftChild(it.id, r.rid, k.rid, {
                                              pct: clampNum(e.target.value, 0, 100),
                                            });
                                          }}
                                          style={{
                                            width: 72,
                                            minWidth: 72,
                                            maxWidth: 72,
                                            padding: "4px 6px",
                                            fontWeight: 800,
                                            textAlign: "center",
                                            opacity: !isEditing ? 0.7 : 1,
                                            cursor: !isEditing ? "not-allowed" : "text",
                                          }}
                                        />
                                      </td>

                                      <td
                                        style={{
                                          padding: "4px 6px",
                                          fontWeight: 950,
                                          textAlign: "center",
                                        }}
                                      >
                                        {kidTotal}
                                      </td>

                                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                        {isEditing ? (
                                          <button
                                            className="btn"
                                            onClick={() => removeSubRow(it.id, r.rid, k.rid)}
                                            style={{
                                              width: 34,
                                              height: 34,
                                              padding: 0,
                                              borderRadius: 999,
                                            }}
                                            title="Eliminar subfila"
                                          >
                                            ✕
                                          </button>
                                        ) : (
                                          <span />
                                        )}
                                      </td>
                                    </tr>
                                  );
                                });

                                return [groupRow, ...kidsRows];
                              })}

                              <tr style={{ borderTop: "1px solid rgba(2,6,23,0.12)" }}>
                                <td
                                  colSpan={4}
                                  style={{
                                    padding: "6px 6px",
                                    fontWeight: 950,
                                    textAlign: "left",
                                  }}
                                >
                                  TOTAL PROCESO
                                </td>
                                <td
                                  style={{
                                    padding: "6px 6px",
                                    fontWeight: 950,
                                    textAlign: "center",
                                  }}
                                >
                                  {total}
                                </td>
                                <td style={{ padding: "6px 6px" }} />
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        {isEditing && (
                          <button
                            className="btn"
                            onClick={() => addGroup(it.id)}
                            style={{ padding: "6px 10px", fontSize: 12 }}
                          >
                            + Agregar Instancia
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          padding: "10px 12px",
                          background: "rgba(78, 228, 108, 0.12)",
                          borderBottom: "1px solid var(--border)",
                          fontWeight: 950,
                          color: "var(--success)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          minHeight: 44,
                        }}
                      >
                        <span>🎓 SITUACIÓN FINAL</span>

                        <button
                          className="btn"
                          onClick={() => openSim(it)}
                          style={{
                            borderRadius: 999,
                            fontWeight: 950,
                            fontSize: 12,
                            padding: "6px 12px",
                            height: 32,
                          }}
                        >
                          🧪 Abrir simulador
                        </button>
                      </div>

                      <div
                        className="procTableWrap"
                        style={{ padding: 12, overflowX: "hidden" }}
                      >
                        <div style={{ display: "grid", gap: 12 }}>
                          <div
                            style={{
                              border: "1px solid rgba(2,6,23,0.10)",
                              borderRadius: 16,
                              background: "var(--card)",
                              padding: 12,
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            <div style={{ fontWeight: 950, color: "var(--success)" }}>RESUMEN</div>

                            <div
                              style={{
                                overflowX: "auto",
                                WebkitOverflowScrolling: "touch",
                              }}
                            >
                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "separate",
                                  borderSpacing: 0,
                                  fontSize: 13,
                                }}
                              >
                                <thead>
                                  <tr style={{ color: "var(--muted)", fontSize: 12 }}>
                                    <th
                                      style={{
                                        textAlign: "left",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid var(--border)",
                                      }}
                                    >
                                      CRITERIO
                                    </th>
                                    <th
                                      style={{
                                        textAlign: "center",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.10)",
                                        width: 110,
                                      }}
                                    >
                                      HABILITA
                                    </th>
                                    <th
                                      style={{
                                        textAlign: "center",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.10)",
                                        width: 60,
                                      }}
                                    >
                                      INFO
                                    </th>
                                  </tr>
                                </thead>

                                <tbody>
                                  <tr>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        fontWeight: 900,
                                      }}
                                    >
                                      MÍNIMOS
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <span style={sfPillStyle(sfMinStatus)}>
                                        {sfMinStatus}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <InfoTip text={sfMinInfo} />
                                    </td>
                                  </tr>

                                  <tr>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        fontWeight: 900,
                                      }}
                                    >
                                      RECUPERATORIO
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <span style={sfPillStyle(sfRecuStatus)}>
                                        {sfRecuStatus}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <InfoTip text={sfRecuInfo} />
                                    </td>
                                  </tr>

                                  <tr>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        fontWeight: 900,
                                      }}
                                    >
                                      FINAL (FIRMA)
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <span style={sfPillStyle(sfFirmaStatus)}>
                                        {sfFirmaStatus}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 10px",
                                        borderBottom: "1px solid rgba(2,6,23,0.08)",
                                        textAlign: "center",
                                      }}
                                    >
                                      <InfoTip text={sfFirmaInfo} />
                                    </td>
                                  </tr>

                                  <tr>
                                    <td
                                      style={{ padding: "10px 10px", fontWeight: 900 }}
                                    >
                                      EXONERACIÓN
                                    </td>
                                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                                      <span style={sfPillStyle(sfExoStatus)}>
                                        {sfExoStatus}
                                      </span>
                                    </td>
                                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                                      <InfoTip text={sfExoInfo} />
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              updateItem(it.id, {
                                realFinalPanelOpen: !realFinalPanelOpen,
                              })
                            }
                            style={{
                              width: "100%",
                              borderRadius: 16,
                              padding: "12px 12px",
                              fontWeight: 950,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              border: "1px solid rgba(2,6,23,0.10)",
                              background: "rgba(2,6,23,0.03)",
                            }}
                            title={realFinalPanelOpen ? "Ocultar" : "Mostrar"}
                          >
                            <span>📌 EXAMEN FINAL</span>
                            <span style={{ fontWeight: 950 }}>
                              {realFinalPanelOpen ? "▾" : "▸"}
                            </span>
                          </button>

                          {realFinalPanelOpen && (
                            <div
                              style={{
                                border: "1px solid rgba(2,6,23,0.10)",
                                borderRadius: 16,
                                background: "var(--card)",
                                padding: 12,
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              <label
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  alignItems: "center",
                                  padding: 10,
                                  borderRadius: 14,
                                  border: "1px solid rgba(2,6,23,0.10)",
                                  background: "var(--card)",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={!!it.realThirdAttempt}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    updateItem(
                                      it.id,
                                      checked
                                        ? {
                                          realThirdAttempt: true,
                                          realPreferExo: false,
                                          realFinalOn: true,
                                        }
                                        : { realThirdAttempt: false }
                                    );
                                  }}
                                />
                                <div style={{ lineHeight: 1.1 }}>
                                  <div
                                    style={{
                                      fontSize: 13,
                                      fontWeight: 950,
                                      color: "var(--text)",
                                    }}
                                  >
                                    Es mi 3ra oportunidad
                                  </div>
                                  <div
                                    style={{ fontSize: 11, color: "var(--muted)" }}
                                  >
                                    (En 3ra oportunidad no se puede exonerar)
                                  </div>
                                </div>
                              </label>

                              <div style={{ fontWeight: 950, color: "var(--text)" }}>
                                ELEGÍ QUÉ VAS A HACER
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr 1fr",
                                  gap: 8,
                                  background: "rgba(2,6,23,0.04)",
                                  padding: 6,
                                  borderRadius: 16,
                                  border: "1px solid rgba(2,6,23,0.08)",
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => updateItem(it.id, { realAction: "recu" })}
                                  style={{
                                    borderRadius: 14,
                                    padding: "10px 10px",
                                    fontWeight: 950,
                                    fontSize: 12,
                                    background:
                                      it.realAction === "recu" ? "white" : "transparent",
                                    border: "1px solid rgba(2,6,23,0.08)",
                                    boxShadow:
                                      it.realAction === "recu"
                                        ? "0 8px 18px rgba(2,6,23,0.06)"
                                        : "none",
                                  }}
                                >
                                  🧪 Recu
                                </button>

                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() =>
                                    updateItem(it.id, {
                                      realAction: "final",
                                      realPreferExo: false,
                                      realFinalOn: true,
                                    })
                                  }
                                  style={{
                                    borderRadius: 14,
                                    padding: "10px 10px",
                                    fontWeight: 950,
                                    fontSize: 12,
                                    background:
                                      it.realAction === "final" ? "white" : "transparent",
                                    border: "1px solid rgba(2,6,23,0.08)",
                                    boxShadow:
                                      it.realAction === "final"
                                        ? "0 8px 18px rgba(2,6,23,0.06)"
                                        : "none",
                                  }}
                                >
                                  🎓 Final
                                </button>

                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() =>
                                    updateItem(it.id, {
                                      realAction: "exo",
                                      realPreferExo: true,
                                      realFinalOn: false,
                                    })
                                  }
                                  style={{
                                    borderRadius: 14,
                                    padding: "10px 10px",
                                    fontWeight: 950,
                                    fontSize: 12,
                                    background:
                                      it.realAction === "exo" ? "white" : "transparent",
                                    border: "1px solid rgba(2,6,23,0.08)",
                                    boxShadow:
                                      it.realAction === "exo"
                                        ? "0 8px 18px rgba(2,6,23,0.06)"
                                        : "none",
                                  }}
                                  disabled={!realCanExonerar}
                                  title={
                                    it.realThirdAttempt
                                      ? "En 3ra oportunidad no se puede exonerar"
                                      : !validoParaReglas
                                        ? "Primero cumplí mínimos y peso total"
                                        : realCanExonerar
                                          ? "Exonerar"
                                          : "No disponible"
                                  }
                                >
                                  🏅 Exoneración
                                </button>
                              </div>

                              {it.realAction === "recu" && (
                                <div
                                  style={{
                                    border: "1px solid rgba(2,6,23,0.10)",
                                    borderRadius: 16,
                                    padding: 12,
                                    background: "var(--card)",
                                  }}
                                >
                                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                                    🧪 RECUPERATORIO
                                  </div>

                                  <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                                    <div>
                                      <button
                                        type="button"
                                        className="btn"
                                        onClick={() => {
                                          const next = !realRecuOn;
                                          updateItem(
                                            it.id,
                                            next
                                              ? { realRecuOn: true }
                                              : {
                                                realRecuOn: false,
                                                realPreferExo: false,
                                                realUseRecuForFinal: true,
                                              }
                                          );
                                        }}
                                        disabled={!realCanRecu}
                                        style={{
                                          borderRadius: 999,
                                          height: 30,
                                          padding: "0 10px",
                                          fontSize: 11,
                                          fontWeight: 950,
                                          opacity: realCanRecu ? 1 : 0.5,
                                          cursor: realCanRecu ? "pointer" : "not-allowed",
                                        }}
                                        title={
                                          realCanRecu
                                            ? "Marcar si rendiste recu"
                                            : "No habilitado"
                                        }
                                      >
                                        {realRecuOn ? "Rendiste recu: SI" : "Rendiste recu: NO"}
                                      </button>
                                    </div>

                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 120px",
                                        gap: 10,
                                        alignItems: "center",
                                      }}
                                    >
                                      <div>
                                        Puntaje recu:
                                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                                          (solo se edita si está habilitado y marcás "SI")
                                        </div>
                                      </div>

                                      <input
                                        className="input"
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={String(realRecuPct)}
                                        disabled={!(realCanRecu && realRecuOn)}
                                        onChange={(e) =>
                                          updateItem(it.id, { realRecuPct: clampNum(e.target.value, 0, 100) })
                                        }
                                        style={{
                                          textAlign: "center",
                                          fontWeight: 950,
                                          borderRadius: 12,
                                        }}
                                      />
                                    </div>

                                    <div>
                                      Reemplaza: <b>{target.label}</b>
                                    </div>
                                    <div>
                                      Total con recu:{" "}
                                      <b>
                                        {realCanRecu && realRecuOn
                                          ? realTotalConRecu ?? "-"
                                          : "-"}
                                      </b>
                                    </div>
                                    <div>
                                      ¿Exonerás con recu?:{" "}
                                      <b>
                                        {realCanRecu && realRecuOn
                                          ? realExConRecu.ok
                                            ? `SI (nota ${realExConRecu.nota})`
                                            : "NO"
                                          : "-"}
                                      </b>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {it.realAction === "final" && (
                                <div
                                  style={{
                                    border: "1px solid rgba(2,6,23,0.10)",
                                    borderRadius: 16,
                                    padding: 12,
                                    background: "var(--card)",
                                  }}
                                >
                                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                                    🎓 EXAMEN FINAL
                                  </div>

                                  <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                                    <div>
                                      Necesitás firma:{" "}
                                      <b>
                                        {realHasFirma
                                          ? "SI"
                                          : `NO (${realProcesoParaFinal} / 50)`}
                                      </b>
                                    </div>

                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 140px",
                                        gap: 10,
                                        alignItems: "stretch",
                                      }}
                                    >
                                      <div style={{ display: "grid", gap: 6 }}>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 950,
                                            color: "rgba(21,101,192,0.85)",
                                            textTransform: "uppercase",
                                          }}
                                        >
                                          Puntaje examen
                                        </div>

                                        <input
                                          className="input"
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={String(realExamPct)}
                                          disabled={!realHasFirma}
                                          onChange={(e) =>
                                            updateItem(it.id, {
                                              realExamPct: clampNum(e.target.value, 0, 100),
                                              realFinalOn: true,
                                              realPreferExo: false,
                                            })
                                          }
                                          placeholder="0 - 100"
                                          style={{
                                            padding: "10px 12px",
                                            borderRadius: 14,
                                            fontSize: 16,
                                            fontWeight: 950,
                                            textAlign: "center",
                                            border: "2px solid rgba(21,101,192,0.15)",
                                          }}
                                        />

                                        {!realHasFirma && (
                                          <div
                                            style={{
                                              fontSize: 11,
                                              color: "var(--muted)",
                                            }}
                                          >
                                            (Se muestra, pero no se puede editar sin firma)
                                          </div>
                                        )}
                                      </div>

                                      {(() => {
                                        const hasExam =
                                          String(realExamPct) !== "" &&
                                          String(realExamPct) != null;
                                        const previewNota =
                                          realHasFirma && hasExam
                                            ? calcNotaFinalFIUNA(
                                              realProcesoParaFinal,
                                              realExamPct
                                            )
                                            : "-";

                                        const msg =
                                          previewNota === "-"
                                            ? "Pendiente"
                                            : previewNota > 1
                                              ? "Aprobado"
                                              : "Insuf.";

                                        return (
                                          <div
                                            style={{
                                              borderRadius: 16,
                                              border: "1px solid rgba(2,6,23,0.10)",
                                              background: "rgba(2,6,23,0.03)",
                                              padding: 10,
                                              display: "grid",
                                              alignContent: "center",
                                              justifyItems: "center",
                                              minHeight: 84,
                                            }}
                                          >
                                            <div
                                              style={{
                                                fontSize: 10,
                                                fontWeight: 950,
                                                opacity: 0.65,
                                                letterSpacing: 1,
                                              }}
                                            >
                                              NOTA (1–5)
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 32,
                                                fontWeight: 950,
                                                lineHeight: 1,
                                              }}
                                            >
                                              {previewNota}
                                            </div>
                                            <div
                                              style={{
                                                marginTop: 6,
                                                fontSize: 11,
                                                fontWeight: 900,
                                                padding: "4px 10px",
                                                borderRadius: 999,
                                                background: "var(--surface-soft)",
                                                border: "1px solid var(--border)",
                                              }}
                                            >
                                              {msg}
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {it.realAction === "exo" && (
                                <div
                                  style={{
                                    border: "1px solid rgba(2,6,23,0.10)",
                                    borderRadius: 16,
                                    padding: 12,
                                    background: "var(--card)",
                                  }}
                                >
                                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                                    🏅 EXONERACIÓN
                                  </div>

                                  {(() => {
                                    const umbral = (Number(it.semestre) || 0) <= 4 ? 71 : 81;
                                    const mejorProceso =
                                      realTotalConRecu != null
                                        ? Math.max(total, realTotalConRecu)
                                        : total;
                                    const falta = Math.max(0, umbral - mejorProceso);

                                    if (!validoParaReglas) {
                                      return (
                                        <div style={{ fontSize: 13 }}>
                                          Estado: <b>NO disponible</b>. Primero cumplí
                                          mínimos.
                                        </div>
                                      );
                                    }

                                    if (it.realThirdAttempt) {
                                      return (
                                        <div style={{ fontSize: 13 }}>
                                          Estado: <b>NO disponible</b>. En 3ra oportunidad no
                                          se puede exonerar.
                                        </div>
                                      );
                                    }

                                    if (realExPossible.ok) {
                                      return (
                                        <div style={{ fontSize: 13 }}>
                                          ✅ Estado: <b>Disponible</b>. Nota de exoneración:{" "}
                                          <b>{realExPossible.nota}</b>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div style={{ fontSize: 13 }}>
                                        Estado: <b>NO disponible</b>.
                                        <div style={{ marginTop: 6, opacity: 0.85 }}>
                                          Te falta llegar a <b>{falta}</b> puntos para
                                          exonerar.
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ScoreRow({ label, max, value, onChange }: ScoreRowProps) {
  const v = value ?? 0;
  const safe = clampNum(v, 0, max);
  const pct = max ? Math.round((safe / max) * 100) : 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 120px",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {safe} / {max}
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            height: 10,
            borderRadius: 999,
            background: "rgba(2,6,23,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{ width: `${pct}%`, height: "100%", background: "var(--primary)" }}
          />
        </div>
      </div>
      <input
        className="input"
        type="number"
        min={0}
        max={max}
        value={String(v)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
} 
