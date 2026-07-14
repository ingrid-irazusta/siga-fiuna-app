"use client";

import { useEffect, useState } from "react";
import CourseManager, { type CourseRow } from "@/components/CourseManager";
import { useMaintenanceMode } from "@/components/MaintenanceProvider";
import { CAREER_OPTIONS, CURRICULUM_OPTIONS } from "@/lib/academicOptions";

export type SemesterSetupMode = "first-use" | "new-cycle";
export type SemesterSetupStep = "career" | "curriculum" | "subjects" | "summary";

export type SemesterSetupData = {
  career: string;
  curriculum: string;
  subjects: string[];
};

type SemesterSetupWizardProps = {
  open: boolean;
  mode: SemesterSetupMode;
  initialCareer?: string;
  initialCurriculum?: string;
  onClose: () => void;
  onComplete: (data: SemesterSetupData) => void;
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
  const [careerEditable, setCareerEditable] = useState(true);
  const [curriculumEditable, setCurriculumEditable] = useState(true);

  useEffect(() => {
    if (!open) return;

    const startsWithProfile = mode === "new-cycle" && Boolean(initialCareer && initialCurriculum);
    const initialStep: SemesterSetupStep = startsWithProfile ? "subjects" : "career";
    const initialStepIndex = STEPS.findIndex((item) => item.value === initialStep);

    setStep(initialStep);
    setFurthestStep(initialStepIndex);
    setCareer(initialCareer);
    setCurriculum(initialCurriculum);
    setSubjects([]);
    setCareerEditable(!(mode === "new-cycle" && initialCareer));
    setCurriculumEditable(!(mode === "new-cycle" && initialCurriculum));
  }, [open, mode, initialCareer, initialCurriculum]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const currentStepIndex = STEPS.findIndex((item) => item.value === step);
  const cleanSubjects = subjects.map((subject) => subject.materia.trim()).filter(Boolean);

  const goToStep = (nextStep: SemesterSetupStep) => {
    const nextIndex = STEPS.findIndex((item) => item.value === nextStep);
    setStep(nextStep);
    setFurthestStep((current) => Math.max(current, nextIndex));
  };

  const goForward = () => {
    const next = STEPS[currentStepIndex + 1];
    if (next) goToStep(next.value);
  };

  const goBack = () => {
    const previous = STEPS[currentStepIndex - 1];
    if (previous) setStep(previous.value);
  };

  const complete = () => {
    const data: SemesterSetupData = { career, curriculum, subjects: cleanSubjects };
    if (process.env.NODE_ENV === "development") {
      console.log("Configuración de ciclo pendiente de persistencia", data);
    }
    onComplete(data);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="semester-setup-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.52)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: "min(760px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 20,
          background: "var(--card)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
          padding: "clamp(18px, 4vw, 28px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2 id="semester-setup-title" style={{ margin: 0, fontSize: 22 }}>Configurar nuevo ciclo</h2>
            <div style={{ marginTop: 5, color: "var(--muted)", fontSize: 13 }}>
              Define la información académica del ciclo actual.
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Cerrar asistente">Cerrar</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, margin: "22px 0" }}>
          {STEPS.map((item, index) => {
            const active = item.value === step;
            const reached = index <= furthestStep;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => reached && setStep(item.value)}
                disabled={!reached}
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
                  cursor: reached ? "pointer" : "default",
                  opacity: reached ? 1 : 0.65,
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
              <select className="fakeInput" value={career} onChange={(event) => setCareer(event.target.value)}>
                <option value="">Selecciona tu carrera</option>
                {CAREER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
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
              <select className="fakeInput" value={curriculum} onChange={(event) => setCurriculum(event.target.value)}>
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
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Materias del ciclo</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>
                Estas materias alimentarán automáticamente Horario de clases, Clases de hoy, Proceso de evaluación y Horario de exámenes.
              </p>
            </div>

            <CourseManager
              mode="draft"
              embedded
              initialCourses={subjects}
              onCoursesChange={setSubjects}
            />

            <div style={{ padding: 12, borderRadius: 12, background: "var(--primary2)", color: "var(--primary)", fontSize: 13, fontWeight: 750 }}>
              En esta fase, las materias y secciones permanecen como borrador y no modifican tus datos actuales.
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="btn" onClick={goBack}>Volver</button>
              <button type="button" className="btn btnPrimary" onClick={goForward}>Revisar resumen</button>
            </div>
          </div>
        )}

        {step === "summary" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Resumen del ciclo</h3>
              <p style={{ margin: "7px 0 0", color: "var(--muted)" }}>Revisa la configuración antes de continuar.</p>
            </div>

            <div style={{ display: "grid", gap: 9, padding: 15, border: "1px solid var(--border)", borderRadius: 14 }}>
              <div><b>Carrera:</b> {career || "Sin seleccionar"}</div>
              <div><b>Malla:</b> {curriculum || "Sin seleccionar"}</div>
              <div><b>Materias agregadas:</b> {cleanSubjects.length}</div>
              {cleanSubjects.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {cleanSubjects.map((subject, index) => <li key={`${subject}-${index}`}>{subject}</li>)}
                </ul>
              )}
            </div>

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
              <button type="button" className="btn btnPrimary" onClick={complete} disabled={maintenance.isRestricted} title={maintenance.isRestricted ? maintenance.disabledMessage : undefined} style={{ opacity: maintenance.isRestricted ? 0.58 : 1 }}>Configurar ciclo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
