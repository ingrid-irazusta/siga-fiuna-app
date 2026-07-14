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
  calcExoneracion,
  calcParcialPts,
  calcResultadoFinalFIUNA,
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
    return it as CourseItem;
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
  };
}

// ============= MAIN COMPONENT =============

export default function ProcesoPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [simRowsById, setSimRowsById] = useState<Record<string, Row[]>>({});
  const [items, setItems] = useState<CourseItem[]>(DEFAULT_ITEMS);
  const [simOpenId, setSimOpenId] = useState<string | null>(null);
  const [simRecuPctByItem, setSimRecuPctByItem] = useState<Record<string, number>>({});
  const [simFinalPctByItem, setSimFinalPctByItem] = useState<Record<string, number>>({});
  const [simUseRecuForFinalByItem, setSimUseRecuForFinalByItem] = useState<Record<string, boolean>>({});
  const [didLoadProceso, setDidLoadProceso] = useState<boolean>(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [editingItems, setEditingItems] = useState<Record<string, boolean>>({});
  const [draftRowsById, setDraftRowsById] = useState<Record<string, Row[]>>({});
  const [finalModalId, setFinalModalId] = useState<string | null>(null);
  const [courseSituation, setCourseSituation] = useState<"aprobada" | "conserva_firma" | "reprobada_sin_firma">("aprobada");
  const [finalMethod, setFinalMethod] = useState<"exoneracion" | "examen_final">("exoneracion");
  const [finalExamPct, setFinalExamPct] = useState("");
  const [finalOpportunity, setFinalOpportunity] = useState<"" | "1" | "2" | "3">("");
  const [finalStep, setFinalStep] = useState<"form" | "review" | "confirm">("form");
  const [finalVerified, setFinalVerified] = useState(false);
  const [finalFlowMessage, setFinalFlowMessage] = useState("");
  const [signatureYear, setSignatureYear] = useState(String(new Date().getFullYear()));

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

  const openFinalization = (it: CourseItem) => {
    setFinalModalId(it.id);
    setCourseSituation("aprobada");
    setFinalMethod("exoneracion");
    setFinalExamPct("");
    setFinalOpportunity("");
    setFinalStep("form");
    setFinalVerified(false);
    setSignatureYear(String(new Date().getFullYear()));
  };

  const closeFinalization = () => {
    setFinalModalId(null);
    setFinalStep("form");
    setFinalVerified(false);
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
      {finalFlowMessage && (
        <div style={{ padding: "10px 12px", borderRadius: 14, background: "var(--success2)", border: "1px solid var(--success)", color: "var(--success)", fontWeight: 900 }}>
          {finalFlowMessage}
        </div>
      )}
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

        const officialExoneration = calcExoneracion(it.semestre, total);
        const finalExamValue = finalExamPct === "" ? null : Number(finalExamPct);
        const finalExamValid = finalExamValue !== null && Number.isFinite(finalExamValue) && finalExamValue >= 0 && finalExamValue <= 100;
        const officialFinalResult = calcResultadoFinalFIUNA(total, finalExamValid ? finalExamValue : 0);
        const isOfficialExoneration = finalMethod === "exoneracion";
        const officialRp = isOfficialExoneration ? total : officialFinalResult.rendimientoPonderado;
        const officialGrade = isOfficialExoneration ? (officialExoneration.nota ?? 1) : officialFinalResult.notaFinal;
        const officialApproved = isOfficialExoneration ? officialExoneration.ok : officialGrade >= 2;
        const officialFormValid = isOfficialExoneration
          ? officialExoneration.ok
          : finalExamValid && finalOpportunity !== "";
        const signatureYearNumber = Number(signatureYear);
        const situationFormValid = courseSituation === "aprobada"
          ? officialFormValid && officialApproved
          : courseSituation === "conserva_firma"
            ? hab && Number.isInteger(signatureYearNumber) && signatureYearNumber >= 1900 && signatureYearNumber <= 2100
            : true;
        const situationLabel = courseSituation === "aprobada" ? "Aprobada" : courseSituation === "conserva_firma" ? "Conserva firma" : "No conserva firma";

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

                <BigModal open={finalModalId === it.id} title={`🎓 Finalización de la cursada — ${it.nombre}`} onClose={closeFinalization}>
                  <div style={{ display: "grid", gap: 14 }}>
                    {finalStep === "form" && <>
                      <div style={{ fontWeight: 950, fontSize: 17 }}>Selecciona cómo terminó esta cursada.</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                        {[
                          { value: "aprobada", label: "Aprobada", background: "rgba(22,163,74,0.09)", border: "rgba(22,163,74,0.32)", color: "#166534" },
                          { value: "conserva_firma", label: "Conserva firma", background: "rgba(217,119,6,0.09)", border: "rgba(217,119,6,0.32)", color: "#92400e" },
                          { value: "reprobada_sin_firma", label: "No conserva firma", background: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.28)", color: "#991b1b" },
                        ].map(({ value, label, background, border, color }) => {
                          const selected = courseSituation === value;
                          return <button key={value} type="button" className="btn" onClick={() => setCourseSituation(value as typeof courseSituation)} style={{ padding: 14, minHeight: 72, display: "grid", gap: 4, justifyItems: "start", border: selected ? `2px solid ${border}` : "1px solid var(--border)", background: selected ? background : "var(--card)", color: selected ? color : "var(--text)" }}><span style={{ fontWeight: 950 }}>{label}</span></button>;
                        })}
                      </div>

                      {courseSituation === "aprobada" && <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ fontWeight: 950 }}>Forma de aprobación</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn" onClick={() => setFinalMethod("exoneracion")} style={{ background: isOfficialExoneration ? "var(--primary)" : "var(--card)", color: isOfficialExoneration ? "white" : "var(--text)" }}>Exoneración</button>
                          <button type="button" className="btn" onClick={() => setFinalMethod("examen_final")} style={{ background: !isOfficialExoneration ? "var(--primary)" : "var(--card)", color: !isOfficialExoneration ? "white" : "var(--text)" }}>Examen final</button>
                        </div>
                        {!isOfficialExoneration && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                          <label style={{ display: "grid", gap: 6, fontWeight: 850 }}>Porcentaje obtenido<input className="input" type="number" min={0} max={100} value={finalExamPct} onChange={(e) => setFinalExamPct(e.target.value)} placeholder="0–100" /></label>
                          <label style={{ display: "grid", gap: 6, fontWeight: 850 }}>Oportunidad<select className="input" value={finalOpportunity} onChange={(e) => setFinalOpportunity(e.target.value as "" | "1" | "2" | "3")}><option value="">Seleccionar</option><option value="1">1ra</option><option value="2">2da</option><option value="3">3ra</option></select></label>
                        </div>}
                        {isOfficialExoneration && !officialExoneration.ok && <div style={{ padding: 12, borderRadius: 12, background: "rgba(220,38,38,0.10)", color: "rgba(220,38,38,0.95)", fontWeight: 850 }}>Exoneración no disponible. Se requieren {officialExoneration.umbral} puntos y el proceso actual es {total}.</div>}
                        {!isOfficialExoneration && officialFormValid && !officialApproved && <div style={{ padding: 12, borderRadius: 12, background: "rgba(220,38,38,0.10)", color: "rgba(220,38,38,0.95)", fontWeight: 850 }}>El resultado ingresado no corresponde a una materia aprobada. Selecciona “No conserva firma” si así terminó la cursada.</div>}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
                          {[["Proceso", `${total}%`], ["RP definitivo", officialFormValid ? `${officialRp}%` : "—"], ["Nota FIUNA", officialFormValid ? officialGrade : "—"], ["Resultado", officialFormValid ? (officialApproved ? "Aprobada" : "Reprobada") : "—"]].map(([label, value]) => <div key={String(label)} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "rgba(2,6,23,0.02)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div><div style={{ marginTop: 3, fontWeight: 950 }}>{value}</div></div>)}
                        </div>
                      </div>}

                      {courseSituation === "conserva_firma" && <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ padding: 12, borderRadius: 12, background: "var(--primary2)", color: "var(--primary)" }}>La materia dejará de aparecer entre las materias en curso, pero conservará la firma para volver a rendir o mejorarla más adelante.</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                          <div style={{ padding: 10, borderRadius: 12, border: "1px solid var(--border)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>Firma actual</div><div style={{ fontWeight: 950 }}>{hab ? `Habilitada (${total} puntos)` : "No habilitada"}</div></div>
                          <label style={{ display: "grid", gap: 6, fontWeight: 850 }}>Año de obtención<input className="input" type="number" min={1900} max={2100} value={signatureYear} onChange={(e) => setSignatureYear(e.target.value)} /></label>
                        </div>
                        {!hab && <div style={{ color: "rgba(220,38,38,0.95)", fontWeight: 850 }}>El proceso actual no alcanza los requisitos de firma.</div>}
                      </div>}

                      {courseSituation === "reprobada_sin_firma" && <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(220,38,38,0.08)" }}>La materia terminará sin aprobación y sin firma vigente. Esto incluye abandono, pérdida de firma o cualquier caso que requiera volver a cursarla.</div>
                      </div>}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}><button type="button" className="btn" onClick={closeFinalization}>Cancelar</button><button type="button" className="btn" disabled={!situationFormValid} onClick={() => setFinalStep("review")} style={{ opacity: situationFormValid ? 1 : 0.5 }}>Revisar finalización</button></div>
                    </>}

                    {finalStep === "review" && <>
                      <div style={{ fontWeight: 950, fontSize: 17 }}>Resumen de la finalización</div>
                      <div style={{ display: "grid", gap: 7, padding: 12, borderRadius: 14, border: "1px solid var(--border)", background: "rgba(2,6,23,0.02)" }}>
                        <div><b>Materia:</b> {it.nombre}</div><div><b>Semestre:</b> {it.semestre}</div><div><b>Resultado de la cursada:</b> {situationLabel}</div>
                        {courseSituation === "aprobada" && <><div><b>Forma:</b> {isOfficialExoneration ? "Exoneración" : "Examen final"}</div><div><b>Proceso:</b> {total}%</div>{!isOfficialExoneration && <div><b>Examen final:</b> {finalExamValue}%</div>}{!isOfficialExoneration && <div><b>Oportunidad:</b> {finalOpportunity === "1" ? "1ra" : finalOpportunity === "2" ? "2da" : "3ra"}</div>}<div><b>RP definitivo:</b> {officialRp}%</div><div><b>Nota FIUNA:</b> {officialGrade}</div></>}
                        {courseSituation === "conserva_firma" && <><div><b>Firma actual:</b> Habilitada ({total} puntos)</div><div><b>Año:</b> {signatureYear}</div></>}
                        {courseSituation === "reprobada_sin_firma" && <div><b>Estado final:</b> {situationLabel}</div>}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={closeFinalization}>Cancelar</button><button type="button" className="btn" onClick={() => { setFinalVerified(false); setFinalStep("confirm"); }}>Continuar</button></div>
                    </>}

                    {finalStep === "confirm" && <>
                      <div style={{ fontWeight: 950, fontSize: 18 }}>¿Estás seguro de finalizar esta cursada?</div>
                      <div style={{ padding: 12, borderRadius: 12, background: "var(--primary2)", color: "var(--primary)", fontWeight: 850 }}>
                        {courseSituation === "aprobada" && "Se registrará la nota final, se actualizará la malla y la materia dejará de aparecer entre las materias activas."}
                        {courseSituation === "conserva_firma" && "La materia dejará de aparecer entre las materias en curso y quedará registrada como materia con firma."}
                        {courseSituation === "reprobada_sin_firma" && "La materia dejará de aparecer entre las materias activas, no quedará aprobada y no conservará firma vigente."}
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 850 }}><input type="checkbox" checked={finalVerified} onChange={(e) => setFinalVerified(e.target.checked)} />He verificado que el resultado de la cursada es correcto.</label>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={() => setFinalStep("review")}>Volver</button><button type="button" className="btn" disabled={!finalVerified} style={{ opacity: finalVerified ? 1 : 0.5 }} onClick={() => { const pendingData = { materia: it.nombre, semestre: it.semestre, situacion: courseSituation, forma: courseSituation === "aprobada" ? finalMethod : null, proceso: total, examenFinal: courseSituation === "aprobada" ? finalExamValue : null, oportunidad: courseSituation === "aprobada" ? (finalOpportunity || null) : null, rpDefinitivo: courseSituation === "aprobada" ? officialRp : null, notaFinal: courseSituation === "aprobada" ? officialGrade : null, anioFirma: courseSituation === "conserva_firma" ? signatureYear : null }; if (process.env.NODE_ENV === "development") console.log("Finalización de cursada pendiente de persistencia", pendingData); closeFinalization(); setFinalFlowMessage("Flujo validado. La persistencia se conectará en una fase posterior."); window.setTimeout(() => setFinalFlowMessage(""), 4500); }}>Confirmar finalización</button></div>
                    </>}
                  </div>
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

                          <div
                            style={{
                              border: "1px solid rgba(2,6,23,0.10)",
                              borderRadius: 16,
                              background: "var(--card)",
                              padding: 14,
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            <div style={{ fontWeight: 950, color: "var(--primary)" }}>
                              🎓 FINALIZAR CURSADA
                            </div>
                            <div style={{ fontSize: 13, color: "var(--muted)" }}>
                              Cuando termine el semestre y ya conozcas el resultado oficial de esta materia, regístralo aquí.
                            </div>
                            <div>
                              <button type="button" className="btn" onClick={() => openFinalization(it)}>
                                Finalizar cursada
                              </button>
                            </div>
                          </div>
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
