"use client";

import { useEffect, useState } from "react";
import CourseManager, { type CourseRow, type CourseScheduleClass } from "@/components/CourseManager";
import { useMaintenanceMode } from "@/components/MaintenanceProvider";
import { CAREER_OPTIONS, CURRICULUM_OPTIONS } from "@/lib/academicOptions";
import { configureNewCycle } from "@/lib/configureNewCycle";

export type SemesterSetupMode = "first-use" | "new-cycle";
export type SemesterSetupStep = "career" | "curriculum" | "subjects" | "summary" | "confirm";

export type SemesterSetupData = {
  career: string;
  curriculum: string;
  courses: CourseRow[];
  schedule: CourseScheduleClass[];
};

type SemesterSetupWizardProps = {
  open: boolean;
  mode: SemesterSetupMode;
  demoMode?: boolean;
  initialCareer?: string;
  initialCurriculum?: string;
  onClose: () => void;
  onComplete: (data: SemesterSetupData) => void | Promise<void>;
};

const STEPS: Array<{ value: SemesterSetupStep; label: string }> = [
  { value: "career", label: "Carrera" },
  { value: "curriculum", label: "Malla" },
  { value: "subjects", label: "Materias" },
  { value: "summary", label: "Resumen" },
];

export default function SemesterSetupWizard({
  open,
  mode,
  demoMode = false,
  initialCareer = "",
  initialCurriculum = "",
  onClose,
  onComplete,
}: SemesterSetupWizardProps) {
  const maintenance = useMaintenanceMode();
  const [step, setStep] = useState<SemesterSetupStep>("career");
  const [furthestStep, setFurthestStep] = useState(0);
  const [career, setCareer] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [subjects, setSubjects] = useState<CourseRow[]>([]);
  const [draftSchedule, setDraftSchedule] = useState<CourseScheduleClass[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [finalVerified, setFinalVerified] = useState(false);
  const [careerEditable, setCareerEditable] = useState(true);
  const [curriculumEditable, setCurriculumEditable] = useState(true);
  const [initialCareerSnapshot, setInitialCareerSnapshot] = useState("");
  const [initialCurriculumSnapshot, setInitialCurriculumSnapshot] = useState("");
  const [careerEdited, setCareerEdited] = useState(false);
  const [curriculumEdited, setCurriculumEdited] = useState(false);
  const [savingCycle, setSavingCycle] = useState(false);
  const [saveError, setSaveError] = useState("");

  const discardAndClose = () => {
    if (savingCycle) return;
    setSubjects([]);
    setDraftSchedule([]);
    setDraftReady(false);
    setFinalVerified(false);
    setSaveError("");
    onClose();
  };

  useEffect(() => {
    if (!open) return;

    const startsWithProfile = mode === "new-cycle" && Boolean(initialCareer && initialCurriculum);
    const initialStep: SemesterSetupStep = startsWithProfile ? "subjects" : "career";
    const initialStepIndex = STEPS.findIndex((item) => item.value === initialStep);

    setStep(initialStep);
    setFurthestStep(initialStepIndex);
    setCareer(initialCareer);
    setCurriculum(initialCurriculum);
    setInitialCareerSnapshot(initialCareer.trim());
    setInitialCurriculumSnapshot(initialCurriculum.trim());
    setCareerEdited(false);
    setCurriculumEdited(false);
    setSubjects([]);
    setDraftSchedule([]);
    setDraftReady(false);
    setFinalVerified(false);
    setSavingCycle(false);
    setSaveError("");
    setCareerEditable(!(mode === "new-cycle" && initialCareer));
    setCurriculumEditable(!(mode === "new-cycle" && initialCurriculum));
  }, [open, mode, initialCareer, initialCurriculum]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingCycle) discardAndClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose, savingCycle]);

  if (!open) return null;

  const currentStepIndex = STEPS.findIndex((item) => item.value === step);
  const cleanSubjects = subjects.map((subject) => subject.materia.trim()).filter(Boolean);
  const uniqueSubjects = Array.from(new Set(cleanSubjects));
  const scheduleBySubject = uniqueSubjects.map((subject) => ({
    subject,
    classes: draftSchedule
      .filter((item) => item.materia.trim() === subject)
      .slice()
      .sort((a, b) =>
        Number(a.day_id) - Number(b.day_id) ||
        String(a.inicio).localeCompare(String(b.inicio))
      ),
  }));
  const cycleSummaryContent = (
    <div style={{ display: "grid", gap: 9, padding: 15, border: "1px solid var(--border)", borderRadius: 14 }}>
      <div><b>Carrera:</b> {career || "Sin seleccionar"}</div>
      <div><b>Malla:</b> {curriculum || "Sin seleccionar"}</div>
      <div style={{ marginTop: 3, fontWeight: 900, color: "var(--primary)" }}>
        {uniqueSubjects.length} {uniqueSubjects.length === 1 ? "materia" : "materias"} · {draftSchedule.length} {draftSchedule.length === 1 ? "clase seleccionada" : "clases seleccionadas"}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
        {scheduleBySubject.map(({ subject, classes }) => (
          <div key={subject} style={{ display: "grid", gap: 7, padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "rgba(2,6,23,0.02)" }}>
            <div style={{ fontWeight: 900 }}>{subject}</div>
            {classes.map((item) => (
              <div key={`${item.tipo}-${item.seccion}-${item.day_id}-${item.inicio}`} style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
                {item.tipo} — Sección {item.seccion} — {item.dia || "Sin día"} {item.inicio}–{item.fin}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  const handleCoursesChange = (nextCourses: CourseRow[]) => {
    setSubjects(nextCourses);
    setDraftReady(false);
    const courseNames = new Set(nextCourses.map((course) => course.materia.trim()).filter(Boolean));
    setDraftSchedule((current) => current.filter((item) => courseNames.has(item.materia.trim())));
  };

  const goToStep = (nextStep: SemesterSetupStep) => {
    const nextIndex = STEPS.findIndex((item) => item.value === nextStep);
    setStep(nextStep);
    setFurthestStep((current) => Math.max(current, nextIndex));
  };

  const handleDraftReadyChange = (ready: boolean) => {
    setDraftReady(ready);
    if (ready) goToStep("summary");
  };

  const goForward = () => {
    if (step === "subjects" && !draftReady) return;
    const next = STEPS[currentStepIndex + 1];
    if (next) goToStep(next.value);
  };

  const goBack = () => {
    const previous = STEPS[currentStepIndex - 1];
    if (previous) setStep(previous.value);
  };

  const complete = async () => {
    if (savingCycle) return;
    setSaveError("");

    if (!finalVerified) {
      setSaveError("Confirma que revisaste las materias y secciones del nuevo ciclo.");
      return;
    }
    if (maintenance.isRestricted) {
      setSaveError(maintenance.actionMessage);
      return;
    }
    if (!subjects.length || !cleanSubjects.length) {
      setSaveError("Debes seleccionar al menos una materia.");
      return;
    }

    const scheduledSubjects = new Set(
      draftSchedule.map((item) => item.materia.trim()).filter(Boolean)
    );
    if (cleanSubjects.some((subject) => !scheduledSubjects.has(subject))) {
      setSaveError("Todas las materias deben tener al menos una clase seleccionada.");
      return;
    }

    const data: SemesterSetupData = {
      career: career.trim(),
      curriculum: curriculum.trim(),
      courses: subjects,
      schedule: draftSchedule,
    };

    setSavingCycle(true);
    try {
      if (!demoMode) {
        await configureNewCycle({
          career: data.career,
          curriculum: data.curriculum,
          courses: data.courses,
          schedule: data.schedule,
          updateCareer: careerEdited && data.career !== initialCareerSnapshot,
          updateCurriculum: curriculumEdited && data.curriculum !== initialCurriculumSnapshot,
        });
      }
      await onComplete(data);
      setSubjects([]);
      setDraftSchedule([]);
      setDraftReady(false);
      setFinalVerified(false);
      setSaveError("");
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("No se pudo configurar el nuevo ciclo", error);
      }
      setSaveError(error instanceof Error ? error.message : "No se pudo configurar el nuevo ciclo.");
    } finally {
      setSavingCycle(false);
    }
  };

  return (
    <div
      className="semesterSetupOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="semester-setup-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingCycle) discardAndClose();
      }}
      style={{
        position: "fixed",
        top: "var(--app-header-height)",
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.52)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        className={`semesterSetupDialog${step === "subjects" ? " isSubjectsStep" : ""}`}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "calc(100dvh - var(--app-header-height) - 40px)",
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 20,
          background: "var(--card)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
          padding: "clamp(18px, 4vw, 28px)",
        }}
      >
        <div className="semesterSetupHeader" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2 id="semester-setup-title" style={{ margin: 0, fontSize: 22 }}>Configurar nuevo ciclo</h2>
            <div style={{ marginTop: 5, color: "var(--muted)", fontSize: 13 }}>
              Define la información académica del ciclo actual.
            </div>
            {demoMode && (
              <div style={{ width: "fit-content", marginTop: 7, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 999, background: "var(--surface-soft)", color: "var(--text-soft)", fontSize: 11.5, fontWeight: 800 }}>
                Modo demostración — los cambios no se guardarán
              </div>
            )}
          </div>
          <button type="button" className="btn" onClick={discardAndClose} disabled={savingCycle} aria-label={demoMode ? "Salir de la demostración" : "Cerrar asistente"}>
            {demoMode ? "Salir de la demostración" : "Cerrar"}
          </button>
        </div>

        <div className="semesterSetupProgress" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, margin: "22px 0" }}>
          {STEPS.map((item, index) => {
            const active = item.value === step;
            const reached = index <= furthestStep;
            const available = reached && !(item.value === "summary" && !draftReady);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => available && !savingCycle && setStep(item.value)}
                disabled={!available || savingCycle}
                style={{
                  minWidth: 0,
                  padding: "9px 5px",
                  borderRadius: 10,
                  border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                  background: active ? "var(--primary2)" : "transparent",
                  color: active ? "var(--primary)" : "var(--muted)",
                  font: "inherit",
                  fontSize: 12,
                  fontWeight: active || reached ? 850 : 700,
                  cursor: available ? "pointer" : "default",
                  opacity: available ? 1 : 0.65,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {step === "career" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Selecciona tu carrera</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>
                SIGA utilizará esta carrera para cargar tu malla y organizar tus notas.
              </p>
            </div>

            {!careerEditable && career ? (
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--primary2)" }}>
                <div style={{ fontWeight: 900 }}>{career}</div>
                <button type="button" className="btn" onClick={() => setCareerEditable(true)} style={{ marginTop: 10 }}>
                  Cambiar carrera
                </button>
              </div>
            ) : (
              <select className="fakeInput" value={career} onChange={(event) => { setCareer(event.target.value); setCareerEdited(true); }}>
                <option value="">Selecciona tu carrera</option>
                {CAREER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={discardAndClose}>Cancelar</button>
              <button type="button" className="btn btnPrimary" disabled={!career} onClick={goForward} style={{ opacity: career ? 1 : 0.55 }}>
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === "curriculum" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Selecciona tu malla</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>
                Tu malla define las materias, correlatividades y la organización de Notas Finales.
              </p>
            </div>

            {!curriculumEditable && curriculum ? (
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--primary2)" }}>
                <div style={{ fontWeight: 900 }}>Malla {curriculum}</div>
                <button type="button" className="btn" onClick={() => setCurriculumEditable(true)} style={{ marginTop: 10 }}>
                  Cambiar malla
                </button>
              </div>
            ) : (
              <select className="fakeInput" value={curriculum} onChange={(event) => { setCurriculum(event.target.value); setCurriculumEdited(true); }}>
                <option value="">Selecciona la malla</option>
                {CURRICULUM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="btn" onClick={goBack}>Volver</button>
              <button type="button" className="btn btnPrimary" disabled={!curriculum} onClick={goForward} style={{ opacity: curriculum ? 1 : 0.55 }}>
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === "subjects" && (
          <div className="semesterSetupSubjects" style={{ display: "grid", gap: 16 }}>
            <div className="semesterSetupSubjectsIntro">
              <h3 style={{ margin: 0 }}>Materias del ciclo</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>
                Agrega todas las materias y luego busca sus secciones.
              </p>
            </div>

            <CourseManager
              mode="draft"
              embedded
              initialCourses={subjects}
              initialSchedule={draftSchedule}
              onCoursesChange={handleCoursesChange}
              onScheduleChange={setDraftSchedule}
              onDraftReadyChange={handleDraftReadyChange}
            />

            <div className="setupDraftNotice">
              En esta fase, las materias y secciones permanecen como borrador y no modifican tus datos actuales.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-start", gap: 8 }}>
              <button type="button" className="btn" onClick={goBack}>Volver</button>
            </div>
          </div>
        )}

        {step === "summary" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Resumen del ciclo</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>Revisa la configuración antes de continuar.</p>
            </div>

            {cycleSummaryContent}

            <div>
              <div style={{ fontWeight: 900, marginBottom: 7 }}>Al confirmar, estas materias alimentarán automáticamente:</div>
              <ul style={{ margin: 0, paddingLeft: 20, color: "var(--muted)" }}>
                <li>Horario de clases</li>
                <li>Clases de hoy</li>
                <li>Proceso de evaluación</li>
                <li>Horario de exámenes</li>
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="btn" onClick={goBack}>Volver</button>
              <button type="button" className="btn btnPrimary" onClick={() => { setFinalVerified(false); setStep("confirm"); }} disabled={maintenance.isRestricted} title={maintenance.isRestricted ? maintenance.disabledMessage : undefined} style={{ opacity: maintenance.isRestricted ? 0.58 : 1 }}>Configurar ciclo</button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Confirmar nuevo ciclo</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>
                {demoMode ? "Revisa el resultado de la demostración antes de finalizar." : "Revisa qué información se actualizará antes de continuar."}
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              <div style={{ padding: 14, borderRadius: 14, border: "1px solid rgba(220,38,38,0.22)", background: "rgba(220,38,38,0.06)" }}>
                <div style={{ fontWeight: 900, color: "#991b1b", marginBottom: 8 }}>SE ACTUALIZARÁN</div>
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                  <li>Materias en curso</li>
                  <li>Horario de clases</li>
                  <li>Procesos de evaluación activos</li>
                  <li>Evaluaciones activas</li>
                </ul>
              </div>

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid rgba(22,163,74,0.22)", background: "rgba(22,163,74,0.06)" }}>
                <div style={{ fontWeight: 900, color: "#166534", marginBottom: 8 }}>SE CONSERVARÁN</div>
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                  <li>Perfil del estudiante</li>
                  <li>Carrera y malla seleccionadas</li>
                  <li>Notas finales</li>
                  <li>Materias aprobadas</li>
                  <li>Datos de la malla curricular</li>
                </ul>
              </div>
            </div>

            {cycleSummaryContent}

            <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(217,119,6,0.24)", background: "rgba(251,191,36,0.10)", color: "#92400e", fontWeight: 800 }}>
              {demoMode
                ? "Esta es una demostración local. Tus datos reales no se modificarán."
                : "Al confirmar, SIGA actualizará la información activa del ciclo con las materias y secciones seleccionadas."}
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontWeight: 850 }}>
              <input type="checkbox" checked={finalVerified} disabled={savingCycle} onChange={(event) => setFinalVerified(event.target.checked)} style={{ marginTop: 2 }} />
              <span>He revisado las materias y secciones del nuevo ciclo.</span>
            </label>

            {saveError && (
              <div role="alert" style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(220,38,38,0.24)", background: "rgba(220,38,38,0.08)", color: "#991b1b", fontWeight: 800 }}>
                {saveError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="btn" disabled={savingCycle} onClick={() => setStep("summary")}>Volver</button>
              <button type="button" className="btn btnPrimary" onClick={complete} disabled={!finalVerified || maintenance.isRestricted || savingCycle} title={maintenance.isRestricted ? maintenance.disabledMessage : undefined} style={{ opacity: finalVerified && !maintenance.isRestricted && !savingCycle ? 1 : 0.55 }}>
                {savingCycle ? (demoMode ? "Finalizando demostración..." : "Configurando ciclo...") : (demoMode ? "Finalizar demostración" : "Comenzar nuevo ciclo")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
