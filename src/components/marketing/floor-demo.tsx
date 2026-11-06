"use client";

import { useId, useState } from "react";
import { DEMO_BOOKINGS, DEMO_DURATION, DEMO_SERVICES, DEMO_TABLES } from "./demo-data";
import styles from "./marketing.module.css";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// El control recorre las dos franjas seguidas: comidas y cenas.
const STEPS = DEMO_SERVICES.flatMap((s) => {
  const out: number[] = [];
  for (let m = s.from; m <= s.to; m += 15) out.push(m);
  return out;
});

/** Plano de sala de la demo (D-065): qué mesas están ocupadas a cada hora, con las reservas del día. */
export function FloorDemo() {
  const id = useId();
  const [step, setStep] = useState(STEPS.indexOf(21 * 60 + 15));
  const now = STEPS[step]!;
  const busy = new Map(
    DEMO_BOOKINGS.filter((b) => b.start <= now && now < b.start + DEMO_DURATION).map((b) => [b.table, b]),
  );
  const next = DEMO_BOOKINGS.filter((b) => b.start > now).sort((a, b) => a.start - b.start)[0];
  const guests = [...busy.values()].reduce((n, b) => n + b.party, 0);
  const free = DEMO_TABLES.length - busy.size;

  return (
    <div className={styles.demo}>
      <div className={styles.demoBar}>
        <label htmlFor={`${id}-hora`}>Hora</label>
        <input
          id={`${id}-hora`}
          type="range"
          min={0}
          max={STEPS.length - 1}
          value={step}
          onChange={(e) => setStep(Number(e.currentTarget.value))}
          aria-valuetext={hhmm(now)}
        />
        <output htmlFor={`${id}-hora`} className={styles.demoClock}>
          {hhmm(now)}
        </output>
      </div>
      <div className={styles.floor} aria-hidden="true">
        {(["Salón", "Terraza"] as const).map((zone) => (
          <div key={zone} className={styles.zone} style={{ "--rows": zone === "Salón" ? 8 : 4 } as React.CSSProperties}>
            <span className={styles.zoneName}>{zone}</span>
            {DEMO_TABLES.filter((t) => t.zone === zone).map((t) => {
              const b = busy.get(t.name);
              return (
                <div
                  key={t.name}
                  className={`${styles.table} ${styles[`table_${t.shape}`]} ${b ? styles.tableBusy : ""}`}
                  style={{ gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}` }}
                >
                  <strong>{t.name}</strong>
                  <span>{b ? `${b.party} · ${b.name.split(" ")[0]}` : `${t.seats} pl.`}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className={styles.demoStatus} aria-live="polite">
        <strong>
          {busy.size} {busy.size === 1 ? "mesa ocupada" : "mesas ocupadas"}
        </strong>{" "}
        · {free} libres · {guests} comensales en sala
        {next ? ` · Siguiente: ${hhmm(next.start)}, ${next.name} (${next.party})` : " · No quedan reservas"}
      </p>
    </div>
  );
}
