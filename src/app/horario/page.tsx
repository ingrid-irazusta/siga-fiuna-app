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
            <button className="btnPrimary" onClick={() => openNew({ dayId: 1 as DayId })}>
              ＋ Nueva clase
            </button>
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
                            {ev.inicio}–{ev.fin}
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
                      {ev.inicio}
                      <span className="muted"> → </span>
                      {ev.fin}
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

          <label className="calLbl">Materia (de tus cursos en curso)</label>
          <select 
            className="calInp" 
            value={form.materia} 
            onChange={(e) => setForm((f) => ({ ...f, materia: e.target.value }))} 
            disabled={saving}
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
              <label className="calLbl">Sección</label>
              <input 
                className="calInp" 
                value={form.seccion ?? ""} 
                onChange={(e) => setForm((f) => ({ ...f, seccion: e.target.value }))} 
                placeholder="A"
                disabled={saving}
              />
            </div>
          </div>

          <div className="calRow2">
            <div>
              <label className="calLbl">Inicio</label>
              <input 
                className="calInp" 
                type="time" 
                value={form.inicio} 
                onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div>
              <label className="calLbl">Fin</label>
              <input 
                className="calInp" 
                type="time" 
                value={form.fin} 
                onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))}
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label className="calLbl">Profesor</label>
            <input 
              className="calInp" 
              value={form.prof ?? ""} 
              onChange={(e) => setForm((f) => ({ ...f, prof: e.target.value }))} 
              placeholder="Apellido"
              disabled={saving}
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