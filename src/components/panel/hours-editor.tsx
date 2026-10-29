"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_SLOTS_PER_DAY, WEEKDAY_LABELS } from "@/lib/schedule-form";
import styles from "./hours-editor.module.css";

export interface EditableSlot {
  opens: string;
  closes: string;
}

/** Cierre anterior a la apertura: el turno acaba al día siguiente (p. ej. 20:00–02:00). */
function overnight(s: EditableSlot): boolean {
  return Boolean(s.opens && s.closes && s.closes <= s.opens);
}

/**
 * Turnos de un día: «de 13:00 a 16:00» con botón para quitarlo y otro para
 * añadir. Los campos se llaman `<prefijo>s<n>o` / `<prefijo>s<n>c`, el formato
 * que lee el servidor (que valida solapes y formatos).
 */
function SlotList({
  prefix,
  label,
  slots,
  onChange,
}: {
  prefix: string;
  label: string;
  slots: EditableSlot[];
  onChange: (slots: EditableSlot[]) => void;
}) {
  const set = (n: number, patch: Partial<EditableSlot>) =>
    onChange(slots.map((s, i) => (i === n ? { ...s, ...patch } : s)));
  return (
    <div className={styles.slots}>
      {slots.map((s, n) => (
        <div key={n} className={styles.slot}>
          <span className={styles.range}>
            <span className={styles.from}>de</span>
            <input
              type="time"
              name={`${prefix}s${n}o`}
              value={s.opens}
              onChange={(e) => set(n, { opens: e.target.value })}
              aria-label={`${label}, turno ${n + 1}, apertura`}
              required
            />
            <span>a</span>
            <input
              type="time"
              name={`${prefix}s${n}c`}
              value={s.closes}
              onChange={(e) => set(n, { closes: e.target.value })}
              aria-label={`${label}, turno ${n + 1}, cierre`}
              required
            />
          </span>
          {overnight(s) && <span className={styles.hint}>(termina al día siguiente)</span>}
          <button
            type="button"
            className={styles.remove}
            onClick={() => onChange(slots.filter((_, i) => i !== n))}
            aria-label={`Quitar turno ${n + 1} de ${label}`}
            title="Quitar turno"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
      {slots.length < MAX_SLOTS_PER_DAY && (
        <button
          type="button"
          className={styles.add}
          onClick={() => onChange([...slots, { opens: "", closes: "" }])}
          aria-label={`Añadir turno en ${label}`}
        >
          + Añadir turno
        </button>
      )}
    </div>
  );
}

/**
 * Horario semanal: un día por fila con interruptor Abierto/Cerrado, sus
 * turnos y la opción de copiar un día a otros. Un día cerrado no envía turnos.
 */
export function WeeklyHoursEditor({ initial }: { initial: EditableSlot[][] }) {
  const [days, setDays] = useState<EditableSlot[][]>(initial);
  const [source, setSource] = useState(0);
  const [target, setTarget] = useState<"weekdays" | "all" | "weekend">("weekdays");
  const id = useId();

  const setDay = (d: number, slots: EditableSlot[]) => setDays(days.map((s, i) => (i === d ? slots : s)));
  function copy() {
    const targets = target === "all" ? [0, 1, 2, 3, 4, 5, 6] : target === "weekdays" ? [0, 1, 2, 3, 4] : [5, 6];
    const from = days[source]!;
    setDays(days.map((s, i) => (targets.includes(i) && i !== source ? from.map((x) => ({ ...x })) : s)));
  }

  return (
    <div className={styles.editor}>
      {WEEKDAY_LABELS.map((label, d) => {
        const slots = days[d]!;
        const open = slots.length > 0;
        return (
          <div key={label} className={`${styles.day} ${open ? "" : styles.closed}`} role="group" aria-label={label}>
            <span className={styles.dayName}>{label}</span>
            <label className={styles.switch}>
              <input
                type="checkbox"
                role="switch"
                checked={open}
                onChange={(e) => setDay(d, e.target.checked ? [{ opens: "", closes: "" }] : [])}
                aria-label={`${label} abierto`}
              />
              <span aria-hidden="true">{open ? "Abierto" : "Cerrado"}</span>
            </label>
            {open && <SlotList prefix={`d${d + 1}`} label={label} slots={slots} onChange={(s) => setDay(d, s)} />}
          </div>
        );
      })}
      <div className={styles.copy}>
        <label htmlFor={`${id}-from`}>Copiar el horario del</label>
        <select id={`${id}-from`} value={source} onChange={(e) => setSource(Number(e.target.value))}>
          {WEEKDAY_LABELS.map((l, i) => (
            <option key={l} value={i}>
              {l.toLowerCase()}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-to`}>a</label>
        <select
          id={`${id}-to`}
          aria-label="Copiar a"
          value={target}
          onChange={(e) => setTarget(e.target.value as typeof target)}
        >
          <option value="weekdays">lunes a viernes</option>
          <option value="weekend">sábado y domingo</option>
          <option value="all">todos los días</option>
        </select>
        <button type="button" className="secondary" onClick={copy}>
          Copiar
        </button>
      </div>
    </div>
  );
}

/** Excepción de un día: cerrado todo el día o con turnos especiales. */
export function ExceptionSlotsEditor() {
  const [closed, setClosed] = useState(false);
  const [slots, setSlots] = useState<EditableSlot[]>([{ opens: "", closes: "" }]);
  const ref = useRef<HTMLDivElement>(null);
  // Tras guardar, el formulario se limpia: los turnos también.
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const clear = () => {
      setClosed(false);
      setSlots([{ opens: "", closes: "" }]);
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);
  return (
    <div className={styles.exception} ref={ref}>
      <label className="check">
        <input type="checkbox" name="closed" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        Cerrado todo el día
      </label>
      {!closed && (
        <div>
          <span className={styles.exceptionLabel}>Turnos de ese día</span>
          <SlotList prefix="x" label="Excepción" slots={slots} onChange={setSlots} />
        </div>
      )}
    </div>
  );
}
