"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/components/Card";
import { useMaintenanceMode } from "@/components/MaintenanceProvider";
import { getSupabase } from "@/lib/supabaseClient";

export type CourseRow = {
  id?: string;
  semestre: string;
  materia: string;
  firma: string;
  tipos?: string[];
};

export type CourseScheduleClass = {
  tempId: string;
  day_id: number;
  dia: string;
  materia: string;
  tipo: "T" | "P" | "LAB";
  seccion: string;
  inicio: string;
  fin: string;
  prof?: string;
};

type SuggestionResponse = {
  ok: boolean;
  groups: Array<{ materia: string; options: CourseScheduleClass[] }>;
  missing: string[];
};

type CourseManagerProps = {
  mode: "persisted" | "draft";
  userId?: string;
  initialCourses?: CourseRow[];
  initialSchedule?: CourseScheduleClass[];
  loading?: boolean;
  embedded?: boolean;
  onCoursesChange?: (courses: CourseRow[]) => void;
  onScheduleChange?: (classes: CourseScheduleClass[]) => void;
  onDraftReadyChange?: (ready: boolean) => void;
  onScheduleSaved?: () => void | Promise<void>;
};

const SEMESTER_OPTIONS = ["1°", "2°", "3°", "4°", "5°", "6°", "7°", "8°", "9°", "10°", "OPT", "COMPLE"];
const EMPTY_SUGGESTIONS: SuggestionResponse = { ok: false, groups: [], missing: [] };

function normalizeSearch(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCourses(rows: CourseRow[]): CourseRow[] {
  return rows
    .map((course) => ({
      ...course,
      semestre: String(course.semestre || "").trim(),
      materia: String(course.materia || "").trim(),
      firma: String(course.firma || ""),
      tipos: Array.isArray(course.tipos) ? course.tipos : [],
    }))
    .filter((course) => course.materia);
}

export default function CourseManager({
  mode,
  userId = "",
  initialCourses = [],
  initialSchedule = [],
  loading = false,
  embedded = false,
  onCoursesChange,
  onScheduleChange,
  onDraftReadyChange,
  onScheduleSaved,
}: CourseManagerProps) {
  const isDraft = mode === "draft";
  const maintenance = useMaintenanceMode();
  const editsBlocked = maintenance.isRestricted;
  const [courses, setCourses] = useState<CourseRow[]>(initialCourses);
  const [draft, setDraft] = useState<CourseRow[]>(initialCourses);
  const [newCourseSemester, setNewCourseSemester] = useState("");
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseFirma, setNewCourseFirma] = useState("");
  const [editing, setEditing] = useState(isDraft);
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionResponse>(EMPTY_SUGGESTIONS);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, boolean>>({});
  const [savingSuggestions, setSavingSuggestions] = useState(false);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [courseNamesStatus, setCourseNamesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [activeAutocomplete, setActiveAutocomplete] = useState<number | null>(null);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const namesLoaded = useRef(false);

  useEffect(() => {
    setCourses(initialCourses);
    setDraft(initialCourses);
    setEditing(isDraft);
  }, [initialCourses, isDraft]);

  const activeQuery = activeAutocomplete === null
    ? ""
    : activeAutocomplete === -1
      ? newCourseName
      : String(draft[activeAutocomplete]?.materia || "");
  const nameSuggestions = useMemo(() => {
    const query = normalizeSearch(activeQuery);
    if (!query) return [];
    return courseNames
      .map((name) => ({ name, normalized: normalizeSearch(name) }))
      .filter((item) => item.normalized.includes(query))
      .sort((a, b) => {
        const prefixDifference = Number(!a.normalized.startsWith(query)) - Number(!b.normalized.startsWith(query));
        return prefixDifference || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      })
      .slice(0, 8)
      .map((item) => item.name);
  }, [activeQuery, courseNames]);

  const notifyDraft = (next: CourseRow[]) => {
    if (isDraft) {
      onCoursesChange?.(next);
      onDraftReadyChange?.(false);
    }
  };

  const updateDraft = (updater: (current: CourseRow[]) => CourseRow[]) => {
    const next = updater(draft);
    setDraft(next);
    notifyDraft(next);
  };

  const loadCourseNames = async () => {
    if (namesLoaded.current || courseNamesStatus === "loading") return;
    try {
      setCourseNamesStatus("loading");
      const response = await fetch("/api/horario-sugerencias", { method: "GET" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !Array.isArray(data.materias)) {
        setCourseNamesStatus("error");
        return;
      }
      setCourseNames(data.materias.filter((name: unknown) => typeof name === "string"));
      namesLoaded.current = true;
      setCourseNamesStatus("ready");
    } catch (error) {
      console.error("Error loading course names:", error);
      setCourseNamesStatus("error");
    }
  };

  const closeAutocomplete = () => {
    setActiveAutocomplete(null);
    setHighlightedSuggestion(0);
  };

  const selectName = (index: number, name: string) => {
    if (index === -1) {
      setNewCourseName(name);
      closeAutocomplete();
      return;
    }
    updateDraft((current) => current.map((course, i) => i === index ? { ...course, materia: name } : course));
    closeAutocomplete();
  };

  const addDraftCourse = () => {
    const materia = newCourseName.trim();
    if (!materia) {
      setMessage("Escribe el nombre de una materia antes de agregarla.");
      return;
    }
    if (draft.some((course) => normalizeSearch(course.materia) === normalizeSearch(materia))) {
      setMessage("Esa materia ya está en la lista.");
      return;
    }
    updateDraft((current) => [...current, { semestre: newCourseSemester, materia, firma: newCourseFirma, tipos: [] }]);
    setNewCourseSemester("");
    setNewCourseName("");
    setNewCourseFirma("");
    closeAutocomplete();
    setMessage("");
  };

  const handleNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAutocomplete();
      return;
    }
    if (!nameSuggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion((current) => current >= nameSuggestions.length - 1 ? 0 : current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion((current) => current <= 0 ? nameSuggestions.length - 1 : current - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectName(index, nameSuggestions[Math.min(highlightedSuggestion, nameSuggestions.length - 1)]);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSuggestionsLoading(false);
    setSuggestions(EMPTY_SUGGESTIONS);
    setSelectedSuggestions({});
  };

  const openSections = async (rows: CourseRow[]) => {
    setModalOpen(true);
    setSuggestionsLoading(true);
    setSuggestions(EMPTY_SUGGESTIONS);
    setSelectedSuggestions({});
    try {
      const response = await fetch("/api/horario-sugerencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materias: rows.map((course) => ({
            semestre: course.semestre,
            materia: course.materia,
            tipos: course.tipos || [],
          })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setSuggestions({ ok: false, groups: [], missing: rows.map((course) => course.materia) });
        return;
      }

      const nextSuggestions: SuggestionResponse = {
        ok: true,
        groups: Array.isArray(data.groups) ? data.groups : [],
        missing: Array.isArray(data.missing) ? data.missing : [],
      };
      setSuggestions(nextSuggestions);

      const initialSelected: Record<string, boolean> = {};
      if (isDraft) {
        for (const group of nextSuggestions.groups) {
          for (const option of group.options) {
            initialSelected[option.tempId] = initialSchedule.some((existing) =>
              String(existing.materia || "").trim() === String(option.materia || "").trim() &&
              String(existing.tipo || "").trim() === String(option.tipo || "").trim() &&
              String(existing.seccion || "").trim() === String(option.seccion || "").trim() &&
              Number(existing.day_id) === Number(option.day_id) &&
              String(existing.inicio || "").trim() === String(option.inicio || "").trim()
            );
          }
        }
      } else if (userId) {
        const supabase = getSupabase();
        const { data: existingClasses } = await supabase
          .from("student_classes")
          .select("materia, tipo, seccion, day_id")
          .eq("user_id", userId);
        for (const group of nextSuggestions.groups) {
          for (const option of group.options) {
            initialSelected[option.tempId] = (existingClasses || []).some((existing) =>
              String(existing.materia || "").trim() === String(option.materia || "").trim() &&
              String(existing.tipo || "").trim() === String(option.tipo || "").trim() &&
              String(existing.seccion || "").trim() === String(option.seccion || "").trim() &&
              Number(existing.day_id) === Number(option.day_id)
            );
          }
        }
      }
      setSelectedSuggestions(initialSelected);
    } catch (error) {
      console.error("Error loading section suggestions:", error);
      setSuggestions({ ok: false, groups: [], missing: rows.map((course) => course.materia) });
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const saveCourses = async () => {
    if (editsBlocked) {
      setMessage(maintenance.actionMessage);
      return;
    }
    closeAutocomplete();
    const clean = cleanCourses(draft);

    if (isDraft) {
      setCourses(clean);
      setDraft(clean);
      onCoursesChange?.(clean);
      onDraftReadyChange?.(false);
      setMessage(clean.length ? `Borrador listo (${clean.length} materias)` : "No hay materias agregadas");
      if (clean.length) await openSections(clean);
      window.setTimeout(() => setMessage(""), 2500);
      return;
    }

    if (!userId) return;
    const previousNames = new Set(courses.map((course) => course.materia.trim()));
    const nextNames = new Set(clean.map((course) => course.materia.trim()));
    const removedNames = Array.from(previousNames).filter((name) => !nextNames.has(name));
    const supabase = getSupabase();

    if (removedNames.length) {
      await supabase.from("student_classes").delete().eq("user_id", userId).in("materia", removedNames);
    }
    await supabase.from("student_courses").delete().eq("user_id", userId);
    if (clean.length) {
      await supabase.from("student_courses").insert(clean.map((course) => ({
        semestre: course.semestre || null,
        materia: course.materia,
        firma: course.firma || null,
        tipos: course.tipos || [],
        user_id: userId,
      })));
    }
    setCourses(clean);
    setDraft(clean);
    setEditing(false);
    onCoursesChange?.(clean);
    setMessage(clean.length ? `Guardado (${clean.length} materias)` : "No hay materias para guardar");
    if (clean.length) await openSections(clean);
    window.setTimeout(() => setMessage(""), 2500);
  };

  const saveSelectedClasses = async () => {
    if (editsBlocked) {
      setMessage(maintenance.actionMessage);
      return;
    }
    const selectedIds = Object.entries(selectedSuggestions).filter(([, selected]) => selected).map(([id]) => id);
    const selectedClasses = suggestions.groups.flatMap((group) =>
      group.options.filter((option) => selectedIds.includes(option.tempId))
    );

    if (isDraft) {
      const everyCourseSelected = suggestions.missing.length === 0 && suggestions.groups.length > 0 && suggestions.groups.every((group) =>
        group.options.some((option) => selectedIds.includes(option.tempId))
      );
      if (!everyCourseSelected) {
        setMessage("Selecciona al menos una clase para cada materia antes de continuar.");
        return;
      }
      const selectedTypesByCourse = new Map<string, Set<string>>();
      for (const classItem of selectedClasses) {
        const types = selectedTypesByCourse.get(classItem.materia) || new Set<string>();
        types.add(classItem.tipo);
        selectedTypesByCourse.set(classItem.materia, types);
      }
      const coursesWithSelectedTypes = courses.map((course) => ({
        ...course,
        tipos: Array.from(selectedTypesByCourse.get(course.materia) || []),
      }));
      setCourses(coursesWithSelectedTypes);
      setDraft(coursesWithSelectedTypes);
      onCoursesChange?.(coursesWithSelectedTypes);
      onScheduleChange?.(selectedClasses);
      onDraftReadyChange?.(true);
      setMessage(`Selección local lista (${selectedClasses.length} clases)`);
      closeModal();
      window.setTimeout(() => setMessage(""), 2500);
      return;
    }

    if (!userId) return;
    try {
      setSavingSuggestions(true);
      const supabase = getSupabase();
      const { data: existingClasses } = await supabase
        .from("student_classes")
        .select("materia, tipo, seccion, day_id")
        .eq("user_id", userId);
      const newClasses = selectedClasses
        .map((option) => ({
          user_id: userId,
          day_id: option.day_id,
          materia: option.materia,
          tipo: option.tipo,
          seccion: option.seccion,
          inicio: option.inicio,
          fin: option.fin,
          prof: option.prof || null,
        }))
        .filter((candidate) => !(existingClasses || []).some((existing) =>
          String(existing.materia || "").trim() === candidate.materia.trim() &&
          String(existing.tipo || "").trim() === candidate.tipo.trim() &&
          String(existing.seccion || "").trim() === candidate.seccion.trim() &&
          Number(existing.day_id) === Number(candidate.day_id)
        ));
      if (newClasses.length) await supabase.from("student_classes").insert(newClasses);
      await onScheduleSaved?.();
      closeModal();
    } catch (error) {
      console.error("Error saving selected classes:", error);
    } finally {
      setSavingSuggestions(false);
    }
  };

  const controls = editing ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={() => updateDraft((current) => [...current, { semestre: "", materia: "", firma: "", tipos: [] }])}>Agregar materia</button>
      <button type="button" className="btn btnPrimary" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={saveCourses}>Guardar</button>
      {!isDraft && <button type="button" className="btn" onClick={() => { setDraft(courses); setEditing(false); }}>Cancelar</button>}
    </div>
  ) : (
    <button type="button" className="btn" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={() => { setDraft(courses); setEditing(true); }}>Editar</button>
  );
  const draftSelectionComplete =
    suggestions.missing.length === 0 &&
    suggestions.groups.length > 0 &&
    suggestions.groups.every((group) =>
      group.options.some((option) => Boolean(selectedSuggestions[option.tempId]))
    );
  const displayedCourses = editing ? draft : courses;

  const content = loading ? <div className="muted">Cargando materias…</div> : (
    <div style={{ display: "grid", gap: 10 }}>
      {embedded && !isDraft && controls}
      {editsBlocked && <div className="muted" style={{ fontSize: 12 }}>{maintenance.disabledMessage}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="tableMini">
          <thead><tr><th className="semestre">Semestre</th><th>Materia</th><th className="firma">Firma</th></tr></thead>
          <tbody>
            {displayedCourses.map((course, index) => (
              <tr key={course.id || index}>
                <td>{editing ? (
                  <select className="fakeInput" value={course.semestre} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onChange={(event) => updateDraft((current) => current.map((item, i) => i === index ? { ...item, semestre: event.target.value } : item))}>
                    <option value="">Seleccionar</option>
                    {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : <span>{course.semestre || "—"}</span>}</td>
                <td>{editing ? (
                  <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                    <div>
                      <input
                        className="fakeInput"
                        value={course.materia}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={activeAutocomplete === index}
                        autoComplete="off"
                        disabled={editsBlocked}
                        title={editsBlocked ? maintenance.disabledMessage : undefined}
                        onFocus={() => { setActiveAutocomplete(index); setHighlightedSuggestion(0); void loadCourseNames(); }}
                        onChange={(event) => { updateDraft((current) => current.map((item, i) => i === index ? { ...item, materia: event.target.value } : item)); setActiveAutocomplete(index); setHighlightedSuggestion(0); }}
                        onKeyDown={(event) => handleNameKeyDown(event, index)}
                        onBlur={() => window.setTimeout(() => setActiveAutocomplete((current) => current === index ? null : current), 100)}
                      />
                    </div>
                    {activeAutocomplete === index && courseNamesStatus === "loading" && <div className="muted" style={{ fontSize: 12 }}>Cargando nombres de materias…</div>}
                    {activeAutocomplete === index && courseNamesStatus === "ready" && activeQuery.trim() && nameSuggestions.length > 0 && (
                      <div role="listbox" style={{ display: "grid", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
                        {nameSuggestions.map((name, suggestionIndex) => (
                          <button key={name} type="button" role="option" aria-selected={suggestionIndex === highlightedSuggestion} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightedSuggestion(suggestionIndex)} onClick={() => selectName(index, name)} style={{ border: 0, borderBottom: suggestionIndex < nameSuggestions.length - 1 ? "1px solid var(--border)" : 0, padding: "10px 12px", textAlign: "left", font: "inherit", fontWeight: 750, cursor: "pointer", color: "var(--text)", background: suggestionIndex === highlightedSuggestion ? "var(--primary2)" : "var(--card)" }}>{name}</button>
                        ))}
                      </div>
                    )}
                    {activeAutocomplete === index && courseNamesStatus === "ready" && activeQuery.trim() && !nameSuggestions.length && <div className="muted" style={{ fontSize: 12 }}>Sin coincidencias. La materia se guardará con el nombre escrito.</div>}
                    {!isDraft && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["T", "P", "LAB"].map((type) => {
                        const active = (course.tipos || []).includes(type);
                        return <button key={type} type="button" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={() => updateDraft((current) => current.map((item, i) => i === index ? { ...item, tipos: active ? (item.tipos || []).filter((value) => value !== type) : [...(item.tipos || []), type] } : item))} style={{ minWidth: 48, padding: "8px 12px", borderRadius: 12, border: "1px solid var(--border)", background: active ? "var(--success)" : "var(--card)", color: active ? "#fff" : "var(--text)", fontWeight: 800, cursor: editsBlocked ? "not-allowed" : "pointer", opacity: editsBlocked ? 0.6 : 1 }}>{type}</button>;
                      })}
                    </div>}
                  </div>
                ) : <span>{course.materia}</span>}</td>
                <td><div style={{ display: "flex", gap: 8 }}>{editing ? <>
                  <select className="fakeInput" value={course.firma} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onChange={(event) => updateDraft((current) => current.map((item, i) => i === index ? { ...item, firma: event.target.value } : item))}><option value="">—</option><option value="SI">SI</option><option value="NO">NO</option></select>
                  <button type="button" className="btn" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={() => updateDraft((current) => current.filter((_, i) => i !== index))}>Eliminar</button>
                </> : <span>{course.firma || "—"}</span>}</div></td>
              </tr>
            ))}
            {isDraft && !displayedCourses.length && (
              <tr><td colSpan={3}><div className="muted">Aún no agregaste materias.</div></td></tr>
            )}
            {isDraft && editing && (
              <tr className="draftCourseEntryRow">
                <td colSpan={3}>
                  <div className="draftCourseEntryGrid">
                    <select className="fakeInput" value={newCourseSemester} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onChange={(event) => setNewCourseSemester(event.target.value)}>
                      <option value="">Semestre</option>
                      {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                      <input
                        className="fakeInput"
                        value={newCourseName}
                        placeholder="Nombre de la materia"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={activeAutocomplete === -1}
                        autoComplete="off"
                        disabled={editsBlocked}
                        title={editsBlocked ? maintenance.disabledMessage : undefined}
                        onFocus={() => { setActiveAutocomplete(-1); setHighlightedSuggestion(0); void loadCourseNames(); }}
                        onChange={(event) => { setNewCourseName(event.target.value); setActiveAutocomplete(-1); setHighlightedSuggestion(0); }}
                        onKeyDown={(event) => handleNameKeyDown(event, -1)}
                        onBlur={() => window.setTimeout(() => setActiveAutocomplete((current) => current === -1 ? null : current), 100)}
                      />
                      {activeAutocomplete === -1 && courseNamesStatus === "loading" && <div className="muted" style={{ fontSize: 12 }}>Cargando nombres de materias…</div>}
                      {activeAutocomplete === -1 && courseNamesStatus === "ready" && activeQuery.trim() && nameSuggestions.length > 0 && (
                        <div role="listbox" style={{ display: "grid", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)", zIndex: 2 }}>
                          {nameSuggestions.map((name, suggestionIndex) => (
                            <button key={name} type="button" role="option" aria-selected={suggestionIndex === highlightedSuggestion} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightedSuggestion(suggestionIndex)} onClick={() => selectName(-1, name)} style={{ border: 0, borderBottom: suggestionIndex < nameSuggestions.length - 1 ? "1px solid var(--border)" : 0, padding: "10px 12px", textAlign: "left", font: "inherit", fontWeight: 750, cursor: "pointer", color: "var(--text)", background: suggestionIndex === highlightedSuggestion ? "var(--primary2)" : "var(--card)" }}>{name}</button>
                          ))}
                        </div>
                      )}
                      {activeAutocomplete === -1 && courseNamesStatus === "ready" && activeQuery.trim() && !nameSuggestions.length && <div className="muted" style={{ fontSize: 12 }}>Sin coincidencias. La materia se guardará con el nombre escrito.</div>}
                    </div>
                    <select className="fakeInput" value={newCourseFirma} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onChange={(event) => setNewCourseFirma(event.target.value)}>
                      <option value="">—</option>
                      <option value="SI">SI</option>
                      <option value="NO">NO</option>
                    </select>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isDraft && !(editing ? draft.length : courses.length) && <div className="muted">Aún no agregaste materias.</div>}
      {message && <div className="muted" role="status">{message}</div>}
      {embedded && isDraft && (
        <div className="draftCourseActions">
          <button type="button" className="btn" disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={addDraftCourse}>
            Agregar materia
          </button>
          <button type="button" className="btn btnPrimary" disabled={editsBlocked || suggestionsLoading || modalOpen || !cleanCourses(draft).length} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={saveCourses}>
            {suggestionsLoading ? "Buscando secciones…" : "Confirmar materias y buscar secciones"}
          </button>
        </div>
      )}
    </div>
  );

  return <>
    {embedded ? content : <Card title={<span className="sectionLabel">Materias en curso</span>} right={controls}>{content}</Card>}
    {modalOpen && (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, padding: "60px 16px 20px", overflowY: "auto", background: "rgba(15, 23, 42, 0.52)", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        <div style={{ width: "min(860px, 100%)", maxHeight: "85vh", overflowY: "auto", background: "var(--card)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div><div style={{ fontWeight: 900, fontSize: 18 }}>Clases encontradas en la distribución de aulas</div><div className="nfWarning">Las clases dependen de la distribución oficial de aulas de FIUNA.</div><div className="muted" style={{ fontSize: 13 }}>Selecciona las clases que corresponden a tu horario.</div></div>
            <button type="button" className="btn" onClick={closeModal} disabled={savingSuggestions}>Cerrar</button>
          </div>
          <div style={{ padding: 20, display: "grid", gap: 18 }}>
            {suggestionsLoading ? <div className="muted">Buscando coincidencias en la distribución de aulas…</div> : <>
              {!suggestions.groups.length && !suggestions.missing.length && <div className="muted">Aún no hay resultados para mostrar.</div>}
              {suggestions.groups.map((group) => <div key={group.materia} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 10 }}><div style={{ fontWeight: 900 }}>{group.materia}</div>{group.options.map((option) => { const checked = Boolean(selectedSuggestions[option.tempId]); return <label key={option.tempId} title={editsBlocked ? maintenance.disabledMessage : undefined} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 12, padding: 12, borderRadius: 12, border: checked ? "1px solid var(--success)" : "1px solid var(--border)", background: checked ? "var(--success2)" : "var(--card)", cursor: editsBlocked ? "not-allowed" : "pointer", opacity: editsBlocked ? 0.65 : 1 }}><input type="checkbox" checked={checked} disabled={editsBlocked} onChange={() => setSelectedSuggestions((current) => ({ ...current, [option.tempId]: !current[option.tempId] }))} /><div><div style={{ fontWeight: 800 }}>{option.tipo} — Sec. {option.seccion} — {option.dia}</div><div className="metaLine"><span>{option.inicio} - {option.fin}</span><span>{option.prof || "—"}</span></div></div></label>; })}</div>)}
              {!!suggestions.missing.length && <div style={{ border: "1px dashed rgba(180,83,9,0.35)", background: "rgba(251,191,36,0.10)", borderRadius: 14, padding: 14 }}><b>Aún no encontradas en la distribución</b><div className="muted" style={{ marginTop: 6 }}>{suggestions.missing.join(", ")}</div></div>}
            </>}
          </div>
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><button type="button" className="btn" onClick={closeModal}>Cerrar por ahora</button>{isDraft && !draftSelectionComplete && <span className="muted" style={{ fontSize: 12 }}>Selecciona al menos una clase para cada materia antes de generar el horario borrador.</span>}<button type="button" className="btn btnPrimary" onClick={saveSelectedClasses} disabled={savingSuggestions || editsBlocked || (isDraft && !draftSelectionComplete)} title={editsBlocked ? maintenance.disabledMessage : undefined}>{savingSuggestions ? "Guardando…" : isDraft ? "Generar horario borrador" : "Guardar Horario de Clases"}</button></div>
        </div>
      </div>
    )}
  </>;
}
