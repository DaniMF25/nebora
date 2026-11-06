"use client";

import { useEffect, useState } from "react";
import styles from "./marketing.module.css";

interface Ticket {
  kind: string;
  lines: string[];
  stamp?: string;
}

/** Lo que llega al pase de La Lonja del Puerto un viernes (datos del restaurante de ejemplo). */
const TICKETS: Ticket[] = [
  { kind: "Reserva web", lines: ["Vie 21:00 · 4 pers.", "Lucía Romero", "Celiaca: sin gluten", "Mesa T1 asignada"], stamp: "Confirmada" },
  { kind: "Stock bajo", lines: ["Jamón ibérico", "600 g en Cámara", "Mínimo: 1 kg"], stamp: "Pedir" },
  { kind: "Carta publicada", lines: ["Carta · versión 2", "+ Arroz negro con alioli", "QR de las mesas: igual"], stamp: "En línea" },
  { kind: "Turno", lines: ["Laura Gil · Sala", "Sáb 19:30 – 23:59", "Semana: 24 h 58 min"] },
  { kind: "Escandallo", lines: ["Croquetas · ración", "Coste 3,01 € · PVP 9,50 €", "Coste sobre precio 31,7 %"], stamp: "OK" },
  { kind: "Reserva web", lines: ["Vie 21:30 · 2 pers.", "Pablo y Ana", "Aniversario", "Mesa T4 asignada"], stamp: "Confirmada" },
];
const EVERY_MS = 2800;
const VISIBLE = 3;

/**
 * Impresora de comandas de la portada (D-065): cada pocos segundos «imprime»
 * un aviso del panel. Decorativa: el mismo contenido está en el texto de la
 * página. Con «reducir movimiento» se queda quieta.
 */
export function TicketPrinter() {
  const [count, setCount] = useState(VISIBLE);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (!id) id = setInterval(() => setCount((c) => c + 1), EVERY_MS);
    };
    const stop = () => {
      clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Los tres últimos, el más nuevo arriba (sale de la impresora).
  const shown = Array.from({ length: VISIBLE }, (_, i) => count - 1 - i).filter((n) => n >= 0);
  return (
    <div className={styles.printer} aria-hidden="true">
      <div className={styles.printerHead}>
        <span>Nébora · pase</span>
        <span className={styles.printerLed} />
      </div>
      <div className={styles.printerOut}>
        {shown.map((n, i) => {
          const tk = TICKETS[n % TICKETS.length]!;
          return (
            <div key={n} className={`${styles.ticket} ${i === 0 ? styles.ticketNew : ""}`}>
              <div className={styles.ticketTop}>
                <strong>{tk.kind}</strong>
                <span>#{String(141 + n).padStart(4, "0")}</span>
              </div>
              {tk.lines.map((l) => (
                <div key={l}>{l}</div>
              ))}
              {tk.stamp && <span className={styles.ticketStamp}>{tk.stamp}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
