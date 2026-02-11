"use client";

import { useEffect, useMemo, useState } from "react";

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
  id: number;
  materia: string;
  tipo: "T" | "P";
  seccion?: string;
  inicio: string;
  fin: string;
  prof?: string;
};

type Schedule = Record<DayId, ScheduleEvent[]>;

const seed: Schedule = {
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
};

const SCHEDULE_KEY = "fiuna_os_schedule_v1";

function loadSchedule(): Schedule {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(SCHEDULE_KEY);
    if (!raw) return seed;
    const parsed: Schedule = JSON.parse(raw);
    for (let i = 1; i <= 6; i++) {
      if (!Object.prototype.hasOwnProperty.call(parsed, i)) return seed;
    }
    return parsed;
  } catch {
    return seed;
  }
}

function saveSchedule(nextSchedule: Schedule) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(nextSchedule));
  } catch {}
}

// --- COMPONENTS ---
type BadgeProps = {
  tipo: "T" | "P";
  seccion?: string;
};

function Badge({ tipo, seccion }: BadgeProps) {
  const isTeo = tipo === "T";
  return (
    <div className="calBadges">
      <span className={`calBadge ${isTeo ? "teo" : "prac"}`}>{tipo}</span>
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
  const [mode, setMode] = useState<"week" | "day">("week");
  const [activeDay, setActiveDay] = useState<DayId>(1);
  const [schedule, setSchedule] = useState<Schedule>(seed);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<{ dayId: DayId; id: number } | null>(null);

  const [form, setForm] = useState<ScheduleEvent & { dayId: DayId }>({
    dayId: 1,
    materia: "",
    tipo: "T",
    seccion: "",
    inicio: "08:00",
    fin: "09:00",
    prof: "",
    id: 0,
  });

  useEffect(() => {
    const stored = loadSchedule();
    setSchedule(stored);
  }, []);

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
      id: 0,
    });
    setIsModalOpen(true);
  };

  const openEdit = (dayId: DayId, ev: ScheduleEvent) => {
    setEditing({ dayId, id: ev.id });
    setForm({ ...ev, dayId });
    setIsModalOpen(true);
  };

  const save = () => {
    if (!form.materia.trim()) return alert("Escribí el nombre de la materia.");
    if (timeToMin(form.fin) <= timeToMin(form.inicio)) return alert("La hora fin debe ser mayor a la hora inicio.");

    setSchedule((prev) => {
      const next = { ...prev };
      if (editing) {
        next[editing.dayId] = (next[editing.dayId] || []).filter((x) => x.id !== editing.id);
      }
      const newId = editing?.id ?? Date.now();
      const item: ScheduleEvent = {
        id: newId,
        materia: form.materia.trim(),
        tipo: form.tipo,
        seccion: form.seccion?.trim() || undefined,
        inicio: form.inicio,
        fin: form.fin,
        prof: form.prof?.trim() || undefined,
      };
      next[form.dayId] = [...(next[form.dayId] || []), item].sort((a, b) => a.inicio.localeCompare(b.inicio));
      saveSchedule(next);
      try { window.dispatchEvent(new Event("fiuna_schedule_updated")); } catch {}
      return next;
    });

    setIsModalOpen(false);
  };

  const del = () => {
    if (!editing) return;
    if (!confirm("¿Borrar esta clase?")) return;
    setSchedule((prev) => {
      const next = { ...prev };
      next[editing.dayId] = (next[editing.dayId] || []).filter((x) => x.id !== editing.id);
      saveSchedule(next);
      try { window.dispatchEvent(new Event("fiuna_schedule_updated")); } catch {}
      return next;
    });
    setIsModalOpen(false);
  };

  const totalMin = (END_HOUR - START_HOUR) * 60;
  const topFor = (t: string) => ((timeToMin(t) - START_HOUR * 60) / totalMin) * 100;
  const heightFor = (a: string, b: string) => ((timeToMin(b) - timeToMin(a)) / totalMin) * 100;

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
                      className={`calEvent ${ev.tipo === "P" ? "prac" : "teo"}`}
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
              <div className="muted">Tocá “Agregar” para crear una clase.</div>
            </div>
          ) : (
            (schedule[activeDay] || []).map((ev) => (
              <div
                key={ev.id}
                className={`calCardItem ${ev.tipo === "P" ? "prac" : "teo"}`}
              >
                <div className="calCardLeft">
                  <div className="calCardTime">
                    {ev.inicio}
                    <span className="muted"> → </span>
                    {ev.fin}
                  </div>
                  <div className="calCardTitle">{ev.materia}</div>
                  <div className="calCardSub">
                    <span className={`calMiniBadge ${ev.tipo === "P" ? "prac" : "teo"}`}>
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

    {/* MODAL */}
    <Modal
      open={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={editing ? "Editar Clase" : "Nueva Clase"}
    >
      <div className="calForm">
        <div className="formGroup">
          <label htmlFor="materia">Materia</label>
          <input
            id="materia"
            type="text"
            placeholder="Ej. Cálculo I"
            value={form.materia}
            onChange={(e) => setForm({ ...form, materia: e.target.value })}
            className="formInput"
          />
        </div>

        <div className="formRow">
          <div className="formGroup">
            <label htmlFor="tipo">Tipo</label>
            <select
              id="tipo"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as "T" | "P" })}
              className="formInput"
            >
              <option value="T">Teoría</option>
              <option value="P">Práctica</option>
            </select>
          </div>
          <div className="formGroup">
            <label htmlFor="seccion">Sección</label>
            <input
              id="seccion"
              type="text"
              placeholder="A, B, 1, 2..."
              value={form.seccion ?? ""}
              onChange={(e) => setForm({ ...form, seccion: e.target.value })}
              className="formInput"
            />
          </div>
        </div>

        <div className="formRow">
          <div className="formGroup">
            <label htmlFor="inicio">Inicio</label>
            <input
              id="inicio"
              type="time"
              value={form.inicio}
              onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              className="formInput"
            />
          </div>
          <div className="formGroup">
            <label htmlFor="fin">Fin</label>
            <input
              id="fin"
              type="time"
              value={form.fin}
              onChange={(e) => setForm({ ...form, fin: e.target.value })}
              className="formInput"
            />
          </div>
        </div>

        <div className="formGroup">
          <label htmlFor="prof">Profesor</label>
          <input
            id="prof"
            type="text"
            placeholder="Nombre del profesor"
            value={form.prof ?? ""}
            onChange={(e) => setForm({ ...form, prof: e.target.value })}
            className="formInput"
          />
        </div>

        <div className="formActions">
          {editing && (
            <button onClick={del} className="btnDanger">
              Borrar
            </button>
          )}
          <div className="formButtonsRight">
            <button onClick={() => setIsModalOpen(false)} className="btnSecondary">
              Cancelar
            </button>
            <button onClick={save} className="btnPrimary">
              {editing ? "Guardar" : "Crear"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  </div>
);
}
