"use client";

import { useState } from "react";
import styles from "./menu-availability-editor.module.css";

interface Rule {
  days: number[];
  opens: string;
  closes: string;
}

const DAYS = [
  { n: 1, short: "L", label: "Lunes" },
  { n: 2, short: "M", label: "Martes" },
  { n: 3, short: "X", label: "Miércoles" },
  { n: 4, short: "J", label: "Jueves" },
  { n: 5, short: "V", label: "Viernes" },
  { n: 6, short: "S", label: "Sábado" },
  { n: 7, short: "D", label: "Domingo" },
];

const MAX_RULES = 7;

/**
 * Horario de una carta (D-036): «siempre» o franjas con sus días («de lunes a
 * viernes, de 08:00 a 12:00»). Envía `mode` y `r<n>d` (días), `r<n>o`, `r<n>c`;
 * el servidor valida y detecta solapes.
 */
export function MenuAvailabilityEditor({ initial }: { initial: Rule[] | null }) {
  const [scheduled, setScheduled] = useState(initial !== null);
  const [rules, setRules] = useState<Rule[]>(initial ?? [{ days: [1, 2, 3, 4, 5], opens: "", closes: "" }]);
  const set = (n: number, patch: Partial<Rule>) => setRules(rules.map((r, i) => (i === n ? { ...r, ...patch } : r)));
  const toggleDay = (n: number, day: number) => {
    const days = rules[n]!.days;
    set(n, { days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort() });
  };

  return (
    <div className={styles.editor}>
      <fieldset className={styles.mode}>
        <legend>¿Cuándo se sirve?</legend>
        <label className="check">
          <input type="radio" name="mode" value="always" checked={!scheduled} onChange={() => setScheduled(false)} />
          Siempre
        </label>
        <label className="check">
          <input type="radio" name="mode" value="scheduled" checked={scheduled} onChange={() => setScheduled(true)} />
          Solo en estas franjas
        </label>
      </fieldset>
      {scheduled && (
        <div className={styles.rules}>
          {rules.map((rule, n) => (
            <div key={n} className={styles.rule} role="group" aria-label={`Franja ${n + 1}`}>
              <div className={styles.days}>
                {DAYS.map((d) => (
                  <label key={d.n} className={styles.day} title={d.label}>
                    <input
                      type="checkbox"
                      name={`r${n}d`}
                      value={d.n}
                      checked={rule.days.includes(d.n)}
                      onChange={() => toggleDay(n, d.n)}
                      aria-label={`${d.label}, franja ${n + 1}`}
                    />
                    <span aria-hidden="true">{d.short}</span>
                  </label>
                ))}
              </div>
              <div className={styles.times}>
                <span className={styles.muted}>de</span>
                <input
                  type="time"
                  name={`r${n}o`}
                  value={rule.opens}
                  onChange={(e) => set(n, { opens: e.target.value })}
                  aria-label={`Franja ${n + 1}, inicio`}
                  required
                />
                <span className={styles.muted}>a</span>
                <input
                  type="time"
                  name={`r${n}c`}
                  value={rule.closes}
                  onChange={(e) => set(n, { closes: e.target.value })}
                  aria-label={`Franja ${n + 1}, fin`}
                  required
                />
              </div>
              {rules.length > 1 && (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => setRules(rules.filter((_, i) => i !== n))}
                  aria-label={`Quitar franja ${n + 1}`}
                  title="Quitar franja"
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
              )}
            </div>
          ))}
          {rules.length < MAX_RULES && (
            <button
              type="button"
              className={styles.add}
              onClick={() => setRules([...rules, { days: [6, 7], opens: "", closes: "" }])}
            >
              + Añadir franja
            </button>
          )}
        </div>
      )}
    </div>
  );
}
