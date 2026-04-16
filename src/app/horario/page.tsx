"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "../../lib/supabaseClient";

const DAYS = [
  { id: 1, short: "Lun", long: "Lunes" },
  { id: 2, short: "Mar", long: "Martes" },
  { id: 3, short: "Mié", long: "Miércoles" },
  { id: 4, short: "Jue", long: "Jueves" },
  { id: 5, short: "Vie", long: "Viernes" },
  { id: 6, short: "Sáb", long: "Sábado" },
];

const START_HOUR = 7;
const END_HOUR = 22; // final visible
const SLOT_MIN = 60;

const pad2 = (n: number) => String(n).padStart(2, "0");

const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const minToTime = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

const formatHourMin = (time: string): string => {
  if (!time) return "";
  const parts = time.split(":");
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return time;
};

// --- TYPES ---
type DayId = 1 | 2 | 3 | 4 | 5 | 6;

type ScheduleEvent = {
  id: string;
  materia: string;
  tipo: "T" | "P" | "LAB";
  seccion?: string;
  inicio: string;
  fin: string;
  prof?: string;
};

type Schedule = Record<DayId, ScheduleEvent[]>;

const getTipoClass = (tipo: string) => {
  if (tipo === "T") return "teo";
  if (tipo === "P") return "prac";
  if (tipo === "LAB") return "lab";
  return "";
};

const seed: Schedule = {
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
};

// --- DATABASE FUNCTIONS ---

async function loadScheduleFromDB(userId: string): Promise<Schedule> {
  if (!userId) {
    console.warn("loadScheduleFromDB: No userId provided");
    return seed;
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("student_classes")
      .select("id, day_id, materia, tipo, seccion, inicio, fin, prof")
      .eq("user_id", userId);

    if (error) {
      console.error("Database load error:", error.message, error);
      return seed;
    }

    if (!Array.isArray(data)) {
      console.warn("Database returned non-array data");
      return seed;
    }

    const schedule: Schedule = { ...seed };
    for (const row of data) {
      const dayId = (Number(row.day_id) || 0) as DayId;
      if (dayId < 1 || dayId > 6) {
        console.warn(`Invalid day_id: ${dayId}`);
        continue;
      }
      
      schedule[dayId] = [
        ...(schedule[dayId] || []),
        {
          id: row.id,
          materia: row.materia || "",
          tipo: row.tipo || "T",
          seccion: row.seccion || undefined,
          inicio: row.inicio || "08:00",
          fin: row.fin || "09:00",
          prof: row.prof || undefined,
        },
      ];
    }

    // Sort each day by start time
    for (let i = 1; i <= 6; i++) {
      schedule[i as DayId] = schedule[i as DayId].sort((a, b) =>
        a.inicio.localeCompare(b.inicio)
      );
    }

    return schedule;
  } catch (error) {
    console.error("Exception in loadScheduleFromDB:", error);
    return seed;
  }
}

async function saveScheduleEventToDB(
  userId: string,
  dayId: DayId,
  event: ScheduleEvent
): Promise<string | null> {
  if (!userId) {
    console.error("saveScheduleEventToDB: No userId provided");
    alert("Error: Debes iniciar sesión para crear clases");
    return null;
  }
  
  console.log("Attempting to save event:", { userId, dayId, event });
  
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("student_classes")
      .insert({
        user_id: userId,
        day_id: dayId,
        materia: event.materia,
        tipo: event.tipo,
        seccion: event.seccion || null,
        inicio: event.inicio,
        fin: event.fin,
        prof: event.prof || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Database save error:", error.message, error);
      alert(`Error al guardar: ${error.message}`);
      return null;
    }

    console.log("Event saved successfully with id:", data?.id);
    return data?.id || null;
  } catch (error) {
    console.error("Exception in saveScheduleEventToDB:", error);
    alert("Error inesperado al guardar la clase");
    return null;
  }
}

async function updateScheduleEventToDB(
  eventId: string,
  dayId: DayId,
  event: ScheduleEvent
): Promise<boolean> {
  if (!eventId) {
    console.error("updateScheduleEventToDB: No eventId provided");
    return false;
  }
  
  console.log("Attempting to update event:", { eventId, dayId, event });
  
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("student_classes")
      .update({
        day_id: dayId,
        materia: event.materia,
        tipo: event.tipo,
        seccion: event.seccion || null,
        inicio: event.inicio,
        fin: event.fin,
        prof: event.prof || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId);

    if (error) {
      console.error("Database update error:", error.message, error);
      alert(`Error al actualizar: ${error.message}`);
      return false;
    }

    console.log("Event updated successfully");
    return true;
  } catch (error) {
    console.error("Exception in updateScheduleEventToDB:", error);
    alert("Error inesperado al actualizar la clase");
    return false;
  }
}

async function deleteScheduleEventFromDB(eventId: string): Promise<boolean> {
  if (!eventId) {
    console.error("deleteScheduleEventFromDB: No eventId provided");
    return false;
  }
  
  console.log("Attempting to delete event:", eventId);
  
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("student_classes")
      .delete()
      .eq("id", eventId);

    if (error) {
      console.error("Database delete error:", error.message, error);
      alert(`Error al borrar: ${error.message}`);
      return false;
    }

    console.log("Event deleted successfully");
    return true;
  } catch (error) {
    console.error("Exception in deleteScheduleEventFromDB:", error);
    alert("Error inesperado al borrar la clase");
    return false;
  }
}

// --- COMPONENTS ---
type BadgeProps = {
  tipo: "T" | "P" | "LAB";
  seccion?: string;
};

function Badge({ tipo, seccion }: BadgeProps) {
  return (
    <div className="calBadges">
      <span className={`calBadge ${getTipoClass(tipo)}`}>{tipo}</span>
      {seccion ? <span className="calBadge sec">Sec. {seccion}</span> : null}
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="calModalWrap" role="dialog" aria-modal="true">
      <div className="calModalOverlay" onClick={onClose} />
      <div className="calModal">
        <div className="calModalHead">
          <div className="calModalTitle">{title}</div>
          <button className="calIconBtn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="calModalBody">{children}</div>
      </div>
    </div>
  );
}

export default function HorarioPage() {
  const [userId, setUserId] = useState<string>("");
  const [mode, setMode] = useState<"week" | "day">("week");
  const [activeDay, setActiveDay] = useState<DayId>(1);
  const [schedule, setSchedule] = useState<Schedule>(seed);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<{ dayId: DayId; id: string } | null>(null);

  const [form, setForm] = useState<ScheduleEvent & { dayId: DayId }>({
    dayId: 1,
    materia: "",
    tipo: "T",
    seccion: "",
    inicio: "08:00",
    fin: "09:00",
    prof: "",
    id: "",
  });

  const [courses, setCourses] = useState<{ id: string; materia: string }[]>([]);

  // --- Load userId and schedule on mount ---
  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabase();
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.info("Session error (this is normal if not logged in):", sessionError.message);
          setLoading(false);
          return;
        }

        if (!data.session?.user?.id) {
          console.info("No active session found");
          setLoading(false);
          return;
        }

        const uid = data.session.user.id;
        console.log("User ID loaded:", uid);
        setUserId(uid);

        // Load schedule from DB
        const schedule = await loadScheduleFromDB(uid);
        setSchedule(schedule);

        // Load courses from DB
        const { data: coursesData } = await supabase
          .from("student_courses")
          .select("id, materia")
          .eq("user_id", uid);

        if (coursesData) {
          setCourses(coursesData);
        }
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // --- Subscribe to real-time changes ---
  useEffect(() => {
    if (!userId) return;

    try {
      const supabase = getSupabase();
      const subscription = supabase
        .channel(`student_classes_${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "student_classes",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            console.log("Real-time update received:", payload);
            // Reload schedule when changes occur
            loadScheduleFromDB(userId).then((newSchedule) => {
              setSchedule(newSchedule);
            });
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    } catch (error) {
      console.warn("Exception setting up real-time subscription:", error);
    }
  }, [userId]);

  const hours = useMemo(() => {
    const arr: string[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) arr.push(`${pad2(h)}:00`);
    return arr;
  }, []);

  const openNew = ({ dayId, start }: { dayId: DayId; start?: string }) => {
    const s = start || "08:00";
    const sm = timeToMin(s);
    const em = Math.min(sm + SLOT_MIN, END_HOUR * 60);
    setEditing(null);
    setForm({
      dayId,
      materia: "",
      tipo: "T",
      seccion: "",
      inicio: s,
      fin: minToTime(em),
      prof: "",
      id: "",
    });
    setIsModalOpen(true);
  };

  const openEdit = (dayId: DayId, ev: ScheduleEvent) => {
    setEditing({ dayId, id: ev.id });
    setForm({ ...ev, dayId });
    setIsModalOpen(true);
  };

  const save = async () => {
    // Validation
    if (!form.materia.trim()) {
      alert("Selecciona una materia de tus cursos en curso.");
      return;
    }
    
    if (!form.tipo || !form.tipo.trim()) {
      alert("Selecciona un tipo de clase (T, P o LAB).");
      return;
    }
    
    if (!form.seccion || !form.seccion.trim()) {
      alert("Ingresa el número de sección.");
      return;
    }
    
    if (!form.inicio || !form.inicio.trim()) {
      alert("Ingresa la hora de inicio.");
      return;
    }
    
    if (!form.fin || !form.fin.trim()) {
      alert("Ingresa la hora de fin.");
      return;
    }
    
    if (!form.prof || !form.prof.trim()) {
      alert("Ingresa el nombre del profesor.");
      return;
    }
    
    if (timeToMin(form.fin) <= timeToMin(form.inicio)) {
      alert("La hora fin debe ser mayor a la hora inicio.");
      return;
    }

    if (!userId) {
      alert("Error: Debes iniciar sesión para guardar cambios");
      return;
    }

    // Prevent double-clicking
    if (saving) {
      console.log("Save already in progress");
      return;
    }

    setSaving(true);

    const item: ScheduleEvent = {
      id: form.id || "",
      materia: form.materia.trim(),
      tipo: form.tipo,
      seccion: form.seccion?.trim() || undefined,
      inicio: form.inicio,
      fin: form.fin,
      prof: form.prof?.trim() || undefined,
    };

    try {
      let success = false;

      // Determine if this is an edit or create based on editing state
      if (editing && editing.id) {
        console.log("Updating existing event:", editing.id);
        success = await updateScheduleEventToDB(editing.id, form.dayId, item);
        
        if (!success) {
          alert("No se pudo guardar el cambio. Por favor, verifica tu conexión e intenta de nuevo.");
          setSaving(false);
          return;
        }
      } else {
        console.log("Creating new event");
        const eventId = await saveScheduleEventToDB(userId, form.dayId, item);
        
        if (!eventId) {
          alert("No se pudo crear la clase. Por favor, verifica tu conexión e intenta de nuevo.");
          setSaving(false);
          return;
        }
        
        success = true;
      }

      if (success) {
        // Reload schedule from database
        console.log("Reloading schedule after save");
        const newSchedule = await loadScheduleFromDB(userId);
        setSchedule(newSchedule);
        setIsModalOpen(false);
        console.log("Save completed successfully");
      }
    } catch (error) {
      console.error("Unexpected error in save:", error);
      alert("Error inesperado al guardar. Por favor, intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!editing) return;
    if (!confirm("¿Borrar esta clase?")) return;

    setSaving(true);

    try {
      const success = await deleteScheduleEventFromDB(editing.id);
      
      if (success) {
        if (userId) {
          const newSchedule = await loadScheduleFromDB(userId);
          setSchedule(newSchedule);
        }
        setIsModalOpen(false);
      } else {
        alert("No se pudo borrar la clase. Por favor, intenta de nuevo.");
      }
    } catch (error) {
      console.error("Unexpected error in delete:", error);
      alert("Error inesperado al borrar. Por favor, intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = (): void => {
    if (pdfBusy) return;
    if (Object.values(schedule).every((day) => day.length === 0)) return;

    setPdfBusy(true);
    setTimeout(() => setPdfBusy(false), 900);

    const now = new Date();
    const stamp = now.toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const hours = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      hours.push(`${pad2(h)}:00`);
    }

    const topFor = (t: string) => {
      const totalMin = (END_HOUR - START_HOUR) * 60;
      return ((timeToMin(t) - START_HOUR * 60) / totalMin) * 100;
    };
    
    const heightFor = (a: string, b: string) => {
      const totalMin = (END_HOUR - START_HOUR) * 60;
      return ((timeToMin(b) - timeToMin(a)) / totalMin) * 100;
    };

    const getTipoColorClass = (tipo: string) => {
      if (tipo === "T") return "teo";
      if (tipo === "P") return "prac";
      if (tipo === "LAB") return "lab";
      return "";
    };

    const timeSlotsHtml = hours
      .map((h) => `<div class="calTimeLabel">${h}</div>`)
      .join("");

    const daysHtml = DAYS.map((d) => {
      const eventsHtml = (schedule[d.id as DayId] || [])
        .map((ev) => {
          const tipoClass = getTipoColorClass(ev.tipo);
          const materia = ev.materia.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const prof = (ev.prof || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const seccion = ev.seccion || "";
          const top = topFor(ev.inicio);
          const height = heightFor(ev.inicio, ev.fin);
          const badgeHtml = seccion ? `<span class="calBadge sec">Sec. ${seccion}</span>` : "";
          const profHtml = prof ? `<div class="calEvProf">👨‍🏫 ${prof}</div>` : "";
          const horaInicio = ev.inicio.substring(0, 5);
          const horaFin = ev.fin.substring(0, 5);
          
          return `
            <div class="calEvent ${tipoClass}" style="top: ${top}%; height: ${height}%;">
              <div class="calBadges">
                <span class="calBadge ${tipoClass}">${ev.tipo}</span>
                ${badgeHtml}
              </div>
              <div class="calEvTitle">${materia}</div>
              <div class="calEvMeta">
                <span class="calEvTime">${horaInicio}–${horaFin}</span>
              </div>
              ${profHtml}
            </div>
          `;
        })
        .join("");

      return `
        <div class="calDayCol">
          <div class="calSlotContainer">
            ${eventsHtml}
          </div>
        </div>
      `;
    }).join("");

    const dayHeadersHtml = DAYS.map((d) => `<div class="calHeadCell">${d.long}</div>`).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Horario de clases</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; 
      margin: 18px; 
      color: #0f172a;
      background: #fff;
    }
    .meta { 
      font-size: 11px; 
      color: #64748b; 
      text-align: right; 
      margin-bottom: 12px;
      font-weight: 500;
    }
    
    .calWeek {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .calWeekHead {
      display: grid;
      grid-template-columns: 50px repeat(6, 1fr);
      gap: 0;
      border-bottom: 2px solid #cbd5e1;
      background: #f8fafc;
    }
    
    .calCorner {
      border-right: 1px solid #cbd5e1;
      background: #f1f5f9;
    }
    
    .calHeadCell {
      padding: 10px 8px;
      text-align: center;
      font-weight: 700;
      font-size: 12px;
      border-right: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    
    .calWeekBody {
      display: grid;
      grid-template-columns: 50px repeat(6, 1fr);
      grid-template-rows: repeat(15, 60px);
      gap: 0;
      min-height: 900px;
      position: relative;
    }
    
    .calTimes {
      display: flex;
      flex-direction: column;
      border-right: 2px solid #cbd5e1;
      background: #f8fafc;
      grid-column: 1;
      grid-row: 1 / 16;
    }
    
    .calTimeRow {
      flex: 1;
      display: flex;
      align-items: flex-start;
      border-bottom: 1px solid #e2e8f0;
      height: 60px;
    }
    
    .calTimeLabel {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      padding: 6px 4px;
      text-align: center;
      width: 100%;
    }
    
    .calDays {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      grid-column: 2 / 8;
      grid-row: 1 / 16;
      gap: 0;
    }
    
    .calDayCol {
      position: relative;
      border-right: 1px solid #e2e8f0;
      background: #ffffff;
    }
    
    .calDayCol:last-child {
      border-right: none;
    }
    
    .calSlotContainer {
      position: relative;
      width: 100%;
      height: 100%;
    }
    
    .calEvent {
      position: absolute;
      width: 92%;
      left: 4%;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      text-align: left;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;
      box-sizing: border-box;
      border: 1px solid;
    }
    
    .calEvent.teo {
      background: #e3f2fd;
      border-color: #bbdefb;
      color: #1565c0;
    }
    
    .calEvent.prac {
      background: #f3e5f5;
      border-color: #e1bee7;
      color: #6a1b9a;
    }
    
    .calEvent.lab {
      background: #fff9c4;
      border-color: #fff59d;
      color: #f57f17;
    }
    
    .calBadges {
      display: flex;
      gap: 3px;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .calBadge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 4px;
      border-radius: 3px;
      display: inline-block;
    }
    
    .calBadge.teo {
      background: rgba(21, 101, 192, 0.3);
      color: #1565c0;
    }
    
    .calBadge.prac {
      background: rgba(106, 27, 154, 0.3);
      color: #6a1b9a;
    }
    
    .calBadge.lab {
      background: rgba(245, 127, 23, 0.3);
      color: #f57f17;
    }
    
    .calBadge.sec {
      background: rgba(0, 0, 0, 0.1);
      color: #333;
    }
    
    .calEvTitle {
      font-weight: 700;
      font-size: 0.85rem;
      line-height: 1.2;
    }
    
    .calEvMeta {
      font-size: 0.75rem;
      opacity: 0.85;
    }
    
    .calEvTime {
      font-weight: 600;
    }
    
    .calEvProf {
      font-size: 0.75rem;
      opacity: 0.8;
    }
    
    .printBtn {
      border: 1px solid rgba(15,23,42,0.15);
      background: rgba(34,197,94,0.12);
      padding: 10px 12px;
      border-radius: 8px;
      font-weight: 900;
      cursor: pointer;
      margin-bottom: 12px;
    }
    
    @media print {
      .printBtn { display: none; }
      body { margin: 10mm; }
      .calWeek { border: none; }
    }
  </style>
</head>
<body>
  <button class="printBtn" onclick="window.print()">Guardar como PDF</button>
  <div class="meta">Generado: ${stamp}<br/>S.I.G.A</div>

  <div class="calWeek">
    <div class="calWeekHead">
      <div class="calCorner"></div>
      ${dayHeadersHtml}
    </div>
    
    <div class="calWeekBody">
      <div class="calTimes">
        ${hours.map((h) => `<div class="calTimeRow"><div class="calTimeLabel">${h}</div></div>`).join("")}
      </div>
      
      <div class="calDays">
        ${daysHtml}
      </div>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    window.location.assign(url);
  };

  const topFor = (t: string) => {
    const totalMin = (END_HOUR - START_HOUR) * 60;
    return ((timeToMin(t) - START_HOUR * 60) / totalMin) * 100;
  };
  
  const heightFor = (a: string, b: string) => {
    const totalMin = (END_HOUR - START_HOUR) * 60;
    return ((timeToMin(b) - timeToMin(a)) / totalMin) * 100;
  };

  if (loading) {
    return (
      <div className="pageWrap" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <div>Cargando horario...</div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="pageWrap" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <div className="card cardPad" style={{ textAlign: "center", maxWidth: "400px" }}>
          <div className="h2">Inicia sesión</div>
          <p className="muted" style={{ marginTop: "1rem" }}>Debes iniciar sesión para ver y crear tu horario de clases.</p>
          <a href="/auth/login" className="btnPrimary" style={{ display: "inline-block", marginTop: "1rem" }}>Ir a Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="pageWrap">
      <div className="pageHeader">
        <div className="calTopControls">
          <div className="calToggle">
            <button
              className={`calTBtn ${mode === "day" ? "on" : ""}`}
              onClick={() => setMode("day")}
            >
              Día
            </button>
            <button
              className={`calTBtn ${mode === "week" ? "on" : ""}`}
              onClick={() => setMode("week")}
            >
              Semana
            </button>
          </div>

          {mode === "day" ? (
            <div className="calDayPills">
              {DAYS.map((d) => (
                <button
                  key={d.id}
                  className={`calDayPill ${activeDay === d.id ? "on" : ""}`}
                  onClick={() => setActiveDay(d.id as DayId)}
                >
                  {d.short}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btnPrimary" onClick={() => openNew({ dayId: 1 as DayId })}>
                ＋ Nueva clase
              </button>
              <button
                className="btnPrimary"
                onClick={downloadPdf}
                disabled={Object.values(schedule).every((day) => day.length === 0) || pdfBusy}
                title="Descargar / Guardar como PDF"
                style={Object.values(schedule).every((day) => day.length === 0) || pdfBusy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
              >
                {pdfBusy ? "Generando..." : "⬇ PDF"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WEEK VIEW */}
      {mode === "week" && (
        <div className="card cardPad calWeekCard">
          <div className="calWeek">
            {/* header row */}
            <div className="calWeekHead">
              <div className="calCorner" />
              {DAYS.map((d) => (
                <div key={d.id} className="calHeadCell">
                  {d.long}
                </div>
              ))}
            </div>

            {/* body */}
            <div className="calWeekBody">
              {/* time column */}
              <div className="calTimes">
                {hours.map((h) => (
                  <div key={h} className="calTimeRow">
                    <div className="calTimeLabel">{h}</div>
                  </div>
                ))}
              </div>

              {/* day columns */}
              <div className="calDays">
                {DAYS.map((d) => (
                  <div key={d.id} className="calDayCol">
                    {/* background hour lines */}
                    {hours.map((h) => (
                      <button
                        key={h}
                        className="calSlot"
                        onClick={() => openNew({ dayId: d.id as DayId, start: h })}
                        aria-label={`Agregar clase ${d.long} ${h}`}
                        type="button"
                      />
                    ))}

                    {/* events */}
                    {(schedule[d.id as DayId] || []).map((ev) => (
                      <button
                        key={ev.id}
                        className={`calEvent ${getTipoClass(ev.tipo)}`}
                        style={{
                          top: `${topFor(ev.inicio)}%`,
                          height: `${heightFor(ev.inicio, ev.fin)}%`,
                        }}
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          openEdit(d.id as DayId, ev);
                        }}
                        title={`${ev.materia} (${ev.inicio}-${ev.fin})`}
                        type="button"
                      >
                        <Badge tipo={ev.tipo} seccion={ev.seccion} />
                        <div className="calEvTitle">{ev.materia}</div>
                        <div className="calEvMeta">
                          <span className="calEvTime">
                            {formatHourMin(ev.inicio)}–{formatHourMin(ev.fin)}
                          </span>
                        </div>
                        {ev.prof && <div className="calEvProf">👨‍🏫 {ev.prof}</div>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAY VIEW */}
      {mode === "day" && (
        <div className="card cardPad calDayCard">
          <div className="calDayHeader">
            <div className="h2">{DAYS.find((d) => d.id === activeDay)?.long ?? ""}</div>
            <button
              className="btnPrimary"
              onClick={() => openNew({ dayId: activeDay })}
            >
              ＋ Agregar
            </button>
          </div>

          <div className="calDayList">
            {(schedule[activeDay] || []).length === 0 ? (
              <div className="calEmpty">
                <div className="calEmptyTitle">Día libre</div>
                <div className="muted">Tocá "Agregar" para crear una clase.</div>
              </div>
            ) : (
              (schedule[activeDay] || []).map((ev) => (
                <div
                  key={ev.id}
                  className={`calCardItem ${getTipoClass(ev.tipo)}`}
                >
                  <div className="calCardLeft">
                    <div className="calCardTime">
                      {formatHourMin(ev.inicio)}
                      <span className="muted"> → </span>
                      {formatHourMin(ev.fin)}
                    </div>
                    <div className="calCardTitle">{ev.materia}</div>
                    <div className="calCardSub">
                      <span className={`calMiniBadge ${getTipoClass(ev.tipo)}`}>
                        {ev.tipo}
                      </span>
                      {ev.seccion && (
                        <span className="calMiniBadge sec">Sec. {ev.seccion}</span>
                      )}
                      {ev.prof && <span className="calCardMeta">👨‍🏫 {ev.prof}</span>}
                    </div>
                  </div>
                  <div className="calCardActions">
                    <button
                      className="calIconBtn"
                      onClick={() => openEdit(activeDay, ev)}
                      aria-label="Editar"
                      type="button"
                    >
                      ✎
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? "Editar clase" : "Nueva clase"}
      >
        <div className="calForm">
          <label className="calLbl">Día</label>
          <select 
            className="calInp" 
            value={form.dayId} 
            onChange={(e) => setForm((f) => ({ ...f, dayId: Number(e.target.value) as DayId }))}
            disabled={saving}
          >
            {DAYS.map((d) => (
              <option key={d.id} value={d.id}>{d.long}</option>
            ))}
          </select>

          <label className="calLbl">Materia (de tus cursos en curso) <span style={{ color: 'red' }}>*</span></label>
          <select 
            className="calInp" 
            value={form.materia} 
            onChange={(e) => setForm((f) => ({ ...f, materia: e.target.value }))} 
            disabled={saving}
            required
          >
            <option value="">Selecciona una materia</option>
            {courses.map((c) => (
              <option key={c.id} value={c.materia}>{c.materia}</option>
            ))}
          </select>

          <div className="calRow2">
            <div>
              <label className="calLbl">Tipo</label>
              <div className="calSeg">
                <button 
                  className={`calSegBtn ${form.tipo === "T" ? "on" : ""}`} 
                  onClick={() => setForm((f) => ({ ...f, tipo: "T" }))} 
                  type="button"
                  disabled={saving}
                >
                  T
                </button>
                <button 
                  className={`calSegBtn ${form.tipo === "P" ? "on" : ""}`} 
                  onClick={() => setForm((f) => ({ ...f, tipo: "P" }))} 
                  type="button"
                  disabled={saving}
                >
                  P
                </button>
                <button 
                  className={`calSegBtn ${form.tipo === "LAB" ? "on" : ""}`} 
                  onClick={() => setForm((f) => ({ ...f, tipo: "LAB" }))} 
                  type="button"
                  disabled={saving}
                >
                  LAB
                </button>
              </div>
            </div>
            <div>
              <label className="calLbl">Sección <span style={{ color: 'red' }}>*</span></label>
              <input 
                className="calInp" 
                value={form.seccion ?? ""} 
                onChange={(e) => setForm((f) => ({ ...f, seccion: e.target.value }))} 
                placeholder="A"
                disabled={saving}
                required
              />
            </div>
          </div>

          <div className="calRow2">
            <div>
              <label className="calLbl">Inicio <span style={{ color: 'red' }}>*</span></label>
              <input 
                className="calInp" 
                type="time" 
                value={form.inicio} 
                onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))}
                disabled={saving}
                required
              />
            </div>
            <div>
              <label className="calLbl">Fin <span style={{ color: 'red' }}>*</span></label>
              <input 
                className="calInp" 
                type="time" 
                value={form.fin} 
                onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))}
                disabled={saving}
                required
              />
            </div>
          </div>

          <div>
            <label className="calLbl">Profesor <span style={{ color: 'red' }}>*</span></label>
            <input 
              className="calInp" 
              value={form.prof ?? ""} 
              onChange={(e) => setForm((f) => ({ ...f, prof: e.target.value }))} 
              placeholder="Apellido"
              disabled={saving}
              required
            />
          </div>

          <div className="calModalBtns">
            {editing ? (
              <button 
                className="btnDanger" 
                onClick={del} 
                type="button"
                disabled={saving}
              >
                {saving ? "Borrando..." : "Borrar"}
              </button>
            ) : (
              <div />
            )}
            <div className="calModalBtnsR">
              <button 
                className="btnGhost" 
                onClick={() => setIsModalOpen(false)} 
                type="button"
                disabled={saving}
              >
                Cancelar
              </button>
              <button 
                className="btnPrimary" 
                onClick={() => save()} 
                type="button"
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}