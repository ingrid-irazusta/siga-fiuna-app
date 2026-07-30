"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/components/Card";
import { useMaintenanceMode } from "@/components/MaintenanceProvider";
import { getSupabase } from "@/lib/supabaseClient";
import {
  isMissingAcademicText,
  normalizeClassType,
  normalizeScheduleTime,
  normalizeSection,
  normalizeSubjectName,
} from "@/lib/academicDataNormalization";

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
  aula?: string;
};

type SuggestionResponse = {
  ok: boolean;
  groups: Array<{ materia: string; options: CourseScheduleClass[] }>;
  missing: string[];
  ambiguous: string[];
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
const EMPTY_SUGGESTIONS: SuggestionResponse = { ok: false, groups: [], missing: [], ambiguous: [] };

type ExistingClass = {
  id: string;
  materia: string;
  tipo: string;
  seccion: string | null;
  day_id: number;
  inicio: string;
  fin: string;
  prof: string | null;
};

function isEquivalentClass(
  existing: ExistingClass,
  candidate: Pick<CourseScheduleClass, "materia" | "tipo" | "seccion" | "day_id" | "inicio" | "fin">
) {
  return (
    normalizeSubjectName(existing.materia) === normalizeSubjectName(candidate.materia) &&
    normalizeClassType(existing.tipo) === normalizeClassType(candidate.tipo) &&
    normalizeSection(existing.seccion) === normalizeSection(candidate.seccion) &&
    Number(existing.day_id) === Number(candidate.day_id) &&
    normalizeScheduleTime(existing.inicio) === normalizeScheduleTime(candidate.inicio) &&
    normalizeScheduleTime(existing.fin) === normalizeScheduleTime(candidate.fin)
  );
}

function groupOptionsBySection(options: CourseScheduleClass[]) {
  const sections = new Map<string, { key: string; label: string; options: CourseScheduleClass[] }>();
  for (const option of options) {
    const key = normalizeSection(option.seccion);
    const current = sections.get(key) || {
      key,
      label: option.seccion.trim() || "Sin sección",
      options: [],
    };
    current.options.push(option);
    sections.set(key, current);
  }
  return Array.from(sections.values());
}

const CLASS_TYPE_LABELS: Record<CourseScheduleClass["tipo"], string> = {
  T: "TEORÍA",
  P: "PRÁCTICA",
  LAB: "LABORATORIO",
};

const CLASS_TYPE_ORDER: CourseScheduleClass["tipo"][] = ["T", "P", "LAB"];

function groupOptionsByType(options: CourseScheduleClass[]) {
  return CLASS_TYPE_ORDER
    .map((type) => {
      const typeOptions = options.filter(
        (option) => normalizeClassType(option.tipo) === type
      );
      return {
        key: type,
        label: CLASS_TYPE_LABELS[type],
        options: typeOptions,
        sections: groupOptionsBySection(typeOptions),
      };
    })
    .filter((group) => group.options.length > 0);
}

function initializeSelectionsByType(
  groups: SuggestionResponse["groups"],
  matchesExistingClass: (option: CourseScheduleClass) => boolean
) {
  const initialSelected: Record<string, boolean> = {};

  for (const courseGroup of groups) {
    for (const typeGroup of groupOptionsByType(courseGroup.options)) {
      const selectedSection = typeGroup.sections.find((section) =>
        section.options.some(matchesExistingClass)
      );
      if (!selectedSection) continue;
      for (const option of selectedSection.options) {
        initialSelected[option.tempId] = true;
      }
    }
  }

  return initialSelected;
}

function hasSelectionForEveryType(
  groups: SuggestionResponse["groups"],
  selectedSuggestions: Record<string, boolean>
) {
  return groups.every((courseGroup) =>
    groupOptionsByType(courseGroup.options).every((typeGroup) =>
      typeGroup.options.some((option) => Boolean(selectedSuggestions[option.tempId]))
    )
  );
}

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

type PendingCourseValidation =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "valid"; course: CourseRow };

function validateAndBuildPendingCourse(
  rows: CourseRow[],
  semestreValue: string,
  materiaValue: string,
  firmaValue: string
): PendingCourseValidation {
  const semestre = String(semestreValue || "").trim();
  const materia = String(materiaValue || "").trim();
  const firma = String(firmaValue || "").trim();

  if (!semestre && !materia && !firma) return { status: "empty" };
  if (!semestre) {
    return { status: "invalid", message: "Selecciona el semestre de la materia." };
  }
  if (!SEMESTER_OPTIONS.includes(semestre)) {
    return { status: "invalid", message: "El semestre seleccionado no es válido." };
  }
  if (!materia) {
    return { status: "invalid", message: "Escribe el nombre de una materia antes de agregarla." };
  }
  if (firma && firma !== "SI" && firma !== "NO") {
    return { status: "invalid", message: "La firma seleccionada no es válida." };
  }
  if (rows.some((course) => normalizeSearch(course.materia) === normalizeSearch(materia))) {
    return { status: "invalid", message: "Esa materia ya está en la lista." };
  }

  return {
    status: "valid",
    course: { semestre, materia, firma, tipos: [] },
  };
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

  const clearPendingCourse = () => {
    setNewCourseSemester("");
    setNewCourseName("");
    setNewCourseFirma("");
    closeAutocomplete();
  };

  const addDraftCourse = () => {
    const validation = validateAndBuildPendingCourse(
      draft,
      newCourseSemester,
      newCourseName,
      newCourseFirma
    );
    if (validation.status === "empty") {
      setMessage("Escribe el nombre de una materia antes de agregarla.");
      return;
    }
    if (validation.status === "invalid") {
      setMessage(validation.message);
      return;
    }

    updateDraft((current) => [...current, validation.course]);
    clearPendingCourse();
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
        setSuggestions({ ok: false, groups: [], missing: rows.map((course) => course.materia), ambiguous: [] });
        return;
      }

      const nextSuggestions: SuggestionResponse = {
        ok: true,
        groups: Array.isArray(data.groups) ? data.groups : [],
        missing: Array.isArray(data.missing) ? data.missing : [],
        ambiguous: Array.isArray(data.ambiguous) ? data.ambiguous : [],
      };
      setSuggestions(nextSuggestions);

      let initialSelected: Record<string, boolean> = {};
      if (isDraft) {
        initialSelected = initializeSelectionsByType(
          nextSuggestions.groups,
          (option) =>
            initialSchedule.some((existing) =>
              normalizeSubjectName(existing.materia) === normalizeSubjectName(option.materia) &&
              normalizeClassType(existing.tipo) === normalizeClassType(option.tipo) &&
              normalizeSection(existing.seccion) === normalizeSection(option.seccion) &&
              Number(existing.day_id) === Number(option.day_id) &&
              String(existing.inicio || "").trim() === String(option.inicio || "").trim()
            )
        );
      } else if (userId) {
        const supabase = getSupabase();
        const { data: existingClasses, error: existingClassesError } = await supabase
          .from("student_classes")
          .select("id, materia, tipo, seccion, day_id, inicio, fin, prof")
          .eq("user_id", userId);
        if (existingClassesError) throw existingClassesError;
        initialSelected = initializeSelectionsByType(
          nextSuggestions.groups,
          (option) =>
            (existingClasses || []).some((existing) =>
              isEquivalentClass(existing as ExistingClass, option)
            )
        );
      }
      setSelectedSuggestions(initialSelected);
    } catch (error) {
      console.error("Error loading section suggestions:", error);
      setSuggestions({ ok: false, groups: [], missing: rows.map((course) => course.materia), ambiguous: [] });
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

    if (isDraft) {
      const validation = validateAndBuildPendingCourse(
        draft,
        newCourseSemester,
        newCourseName,
        newCourseFirma
      );
      if (validation.status === "invalid") {
        setMessage(validation.message);
        return;
      }

      const finalCourses = cleanCourses(
        validation.status === "valid" ? [...draft, validation.course] : draft
      );
      if (!finalCourses.length) {
        setMessage("No hay materias agregadas");
        return;
      }

      setCourses(finalCourses);
      setDraft(finalCourses);
      onCoursesChange?.(finalCourses);
      onDraftReadyChange?.(false);
      if (validation.status === "valid") clearPendingCourse();
      setMessage(`Borrador listo (${finalCourses.length} materias)`);
      await openSections(finalCourses);
      window.setTimeout(() => setMessage(""), 2500);
      return;
    }

    const clean = cleanCourses(draft);
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
    if (suggestions.ambiguous.length) {
      setMessage("La distribución contiene clases ambiguas. No se guardó ningún cambio.");
      return;
    }
    const selectedIds = Object.entries(selectedSuggestions).filter(([, selected]) => selected).map(([id]) => id);
    const selectedClasses = suggestions.groups.flatMap((group) =>
      group.options.filter((option) => selectedIds.includes(option.tempId))
    );

    if (isDraft) {
      const everyTypeSelected =
        suggestions.missing.length === 0 &&
        suggestions.groups.length > 0 &&
        hasSelectionForEveryType(suggestions.groups, selectedSuggestions);
      if (!everyTypeSelected) {
        setMessage("Selecciona una sección para cada tipo de clase antes de continuar.");
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
      const { data: existingClasses, error: existingClassesError } = await supabase
        .from("student_classes")
        .select("id, materia, tipo, seccion, day_id, inicio, fin, prof")
        .eq("user_id", userId);
      if (existingClassesError) throw existingClassesError;
      const existingRows = (existingClasses || []) as ExistingClass[];
      const newClasses: Array<{
        user_id: string;
        day_id: number;
        materia: string;
        tipo: string;
        seccion: string | null;
        inicio: string;
        fin: string;
        prof: string | null;
      }> = [];
      const professorRepairs: Array<{ id: string; prof: string }> = [];

      for (const option of selectedClasses) {
        const candidate = {
          user_id: userId,
          day_id: option.day_id,
          materia: option.materia,
          tipo: option.tipo,
          seccion: option.seccion || null,
          inicio: option.inicio,
          fin: option.fin,
          prof: isMissingAcademicText(option.prof) ? null : String(option.prof).trim(),
        };
        const equivalent = existingRows.find((existing) =>
          isEquivalentClass(existing, option)
        );
        if (!equivalent) {
          newClasses.push(candidate);
        } else if (
          isMissingAcademicText(equivalent.prof) &&
          !isMissingAcademicText(candidate.prof)
        ) {
          professorRepairs.push({ id: equivalent.id, prof: candidate.prof as string });
        }
      }

      if (newClasses.length) {
        const { error } = await supabase.from("student_classes").insert(newClasses);
        if (error) throw error;
      }
      for (const repair of professorRepairs) {
        const { error } = await supabase
          .from("student_classes")
          .update({ prof: repair.prof })
          .eq("id", repair.id)
          .eq("user_id", userId);
        if (error) throw error;
      }
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
    hasSelectionForEveryType(suggestions.groups, selectedSuggestions);
  const displayedCourses = editing ? draft : courses;
  const pendingRowHasData = Boolean(
    newCourseSemester || newCourseName.trim() || newCourseFirma
  );

  const content = loading ? <div className="muted">Cargando materias…</div> : (
    <div className={isDraft ? "courseManagerDraft" : undefined} style={{ display: "grid", gap: 10 }}>
      {embedded && !isDraft && controls}
      {editsBlocked && <div className="muted" style={{ fontSize: 12 }}>{maintenance.disabledMessage}</div>}
      <div className={isDraft ? "draftCourseTableWrap" : undefined} style={{ overflowX: "auto" }}>
        <table className={`tableMini${isDraft ? " draftCourseTable" : ""}`}>
          <thead><tr><th className="semestre">Semestre</th><th>Materia</th><th className="firma">Firma</th></tr></thead>
          <tbody>
            {displayedCourses.map((course, index) => (
              <tr key={course.id || index}>
                <td className={isDraft ? "draftCourseSemesterCell" : undefined}>{editing ? (
                  <select className="fakeInput draftCourseCompactSelect" value={course.semestre} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : course.semestre} onChange={(event) => updateDraft((current) => current.map((item, i) => i === index ? { ...item, semestre: event.target.value } : item))}>
                    <option value="">{isDraft ? "—" : "Seleccionar"}</option>
                    {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : <span>{course.semestre || "—"}</span>}</td>
                <td className={isDraft ? "draftCourseNameCell" : undefined}>{editing ? (
                  <div className={isDraft ? "draftCourseNameEditor" : undefined} style={{ display: "grid", gap: 8, minWidth: isDraft ? 0 : 220 }}>
                    <div>
                      <input
                        className="fakeInput"
                        value={course.materia}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={activeAutocomplete === index}
                        autoComplete="off"
                        disabled={editsBlocked}
                        title={editsBlocked ? maintenance.disabledMessage : course.materia}
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
                <td className={isDraft ? "draftCourseFirmaCell" : undefined}><div className={isDraft ? "draftCourseRowActions" : undefined} style={{ display: "flex", gap: 8 }}>{editing ? <>
                  <select className="fakeInput draftCourseCompactSelect" value={course.firma} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : course.firma} onChange={(event) => updateDraft((current) => current.map((item, i) => i === index ? { ...item, firma: event.target.value } : item))}><option value="">—</option><option value="SI">{isDraft ? "Sí" : "SI"}</option><option value="NO">{isDraft ? "No" : "NO"}</option></select>
                  <button type="button" className={`btn${isDraft ? " draftCourseRemoveButton" : ""}`} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : `Eliminar ${course.materia}`} onClick={() => updateDraft((current) => current.filter((_, i) => i !== index))}>Eliminar</button>
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
                    <select className="fakeInput draftCourseCompactSelect" aria-label="Semestre" value={newCourseSemester} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : "Semestre"} onChange={(event) => setNewCourseSemester(event.target.value)}>
                      <option value="">—</option>
                      {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                      <input
                        className="fakeInput"
                        value={newCourseName}
                        placeholder="Materia"
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
                    <select className="fakeInput draftCourseCompactSelect" aria-label="Firma" value={newCourseFirma} disabled={editsBlocked} title={editsBlocked ? maintenance.disabledMessage : "Firma"} onChange={(event) => setNewCourseFirma(event.target.value)}>
                      <option value="">—</option>
                      <option value="SI">Sí</option>
                      <option value="NO">No</option>
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
          <button type="button" className="btn btnPrimary" disabled={editsBlocked || suggestionsLoading || modalOpen || (!cleanCourses(draft).length && !pendingRowHasData)} title={editsBlocked ? maintenance.disabledMessage : undefined} onClick={saveCourses}>
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
              {suggestions.groups.map((group) => (
                <div key={group.materia} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{group.materia}</div>
                  {groupOptionsByType(group.options).map((typeGroup) => (
                    <div key={typeGroup.key} style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontWeight: 850, fontSize: 13 }}>{typeGroup.label}</div>
                      {typeGroup.sections.map((section) => {
                        const checked = section.options.every((option) => Boolean(selectedSuggestions[option.tempId]));
                        return (
                          <label
                            key={`${typeGroup.key}-${section.key || "SIN_SECCION"}`}
                            title={editsBlocked ? maintenance.disabledMessage : undefined}
                            style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 12, padding: 12, borderRadius: 12, border: checked ? "1px solid var(--success)" : "1px solid var(--border)", background: checked ? "var(--success2)" : "var(--card)", cursor: editsBlocked ? "not-allowed" : "pointer", opacity: editsBlocked ? 0.65 : 1 }}
                          >
                            <input
                              type="radio"
                              name={`section-${normalizeSubjectName(group.materia)}-${typeGroup.key}`}
                              checked={checked}
                              disabled={editsBlocked}
                              onChange={() => setSelectedSuggestions((current) => {
                                const next = { ...current };
                                for (const option of typeGroup.options) delete next[option.tempId];
                                for (const option of section.options) next[option.tempId] = true;
                                return next;
                              })}
                            />
                            <div style={{ display: "grid", gap: 7 }}>
                              <div style={{ fontWeight: 850 }}>Sección {section.label}</div>
                              {section.options.map((option) => (
                                <div key={option.tempId} className="metaLine">
                                  <span>{option.dia} — {option.inicio} - {option.fin}</span>
                                  <span>👨‍🏫 Profesor: {option.prof || "Pendiente"}{option.aula ? ` · Aula: ${option.aula}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
              {!!suggestions.ambiguous.length && <div style={{ border: "1px dashed rgba(180,83,9,0.35)", background: "rgba(251,191,36,0.10)", borderRadius: 14, padding: 14 }}><b>Datos ambiguos en la distribución</b><div className="muted" style={{ marginTop: 6 }}>{suggestions.ambiguous.join(", ")}</div></div>}
              {!!suggestions.missing.length && <div style={{ border: "1px dashed rgba(180,83,9,0.35)", background: "rgba(251,191,36,0.10)", borderRadius: 14, padding: 14 }}><b>Aún no encontradas en la distribución</b><div className="muted" style={{ marginTop: 6 }}>{suggestions.missing.join(", ")}</div></div>}
            </>}
          </div>
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><button type="button" className="btn" onClick={closeModal}>Cerrar por ahora</button>{isDraft && !draftSelectionComplete && <span className="muted" style={{ fontSize: 12 }}>Selecciona una sección para cada tipo de clase antes de generar el horario borrador.</span>}<button type="button" className="btn btnPrimary" onClick={saveSelectedClasses} disabled={savingSuggestions || editsBlocked || suggestions.ambiguous.length > 0 || (isDraft && !draftSelectionComplete)} title={editsBlocked ? maintenance.disabledMessage : undefined}>{savingSuggestions ? "Guardando…" : isDraft ? "Generar horario borrador" : "Guardar Horario de Clases"}</button></div>
        </div>
      </div>
    )}
  </>;
}
