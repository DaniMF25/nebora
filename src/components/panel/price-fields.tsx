"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_FORMATS, MAX_FORMAT_LABEL, SUGGESTED_FORMATS } from "@/lib/price-formats";
import styles from "./price-fields.module.css";

interface Row {
  label: string;
  price: string;
}

/**
 * Precio del producto: único o por formatos (D-038). Envía `price`, o bien
 * `formats=on` con `f<n>l` (nombre) y `f<n>p` (precio) por formato.
 */
export function PriceFields({ price, formats }: { price: string; formats: Row[] | null }) {
  const [multi, setMulti] = useState(formats !== null);
  const [rows, setRows] = useState<Row[]>(
    formats ?? [
      { label: "Media ración", price: "" },
      { label: "Ración", price: price },
    ],
  );
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Tras guardar, el formulario se limpia: los formatos vuelven a como estaban.
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const reset = () => {
      setMulti(formats !== null);
      setRows(
        formats ?? [
          { label: "Media ración", price: "" },
          { label: "Ración", price },
        ],
      );
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [formats, price]);
  const set = (n: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)));

  return (
    <div className={styles.price} ref={ref}>
      {!multi && (
        <label>
          Precio (€)
          <input name="price" inputMode="decimal" required placeholder="12,50" defaultValue={price} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" name="formats" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        Varios formatos (media ración y ración, copa y botella…)
      </label>
      {multi && (
        <div className={styles.rows}>
          <datalist id={listId}>
            {SUGGESTED_FORMATS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {rows.map((r, n) => (
            <div key={n} className={styles.row} role="group" aria-label={`Formato ${n + 1}`}>
              <input
                name={`f${n}l`}
                value={r.label}
                onChange={(e) => set(n, { label: e.target.value })}
                list={listId}
                maxLength={MAX_FORMAT_LABEL}
                required
                aria-label={`Formato ${n + 1}, nombre`}
                placeholder="Ración"
              />
              <input
                name={`f${n}p`}
                value={r.price}
                onChange={(e) => set(n, { price: e.target.value })}
                inputMode="decimal"
                required
                aria-label={`Formato ${n + 1}, precio (€)`}
                placeholder="12,50"
              />
              <span className={styles.euro} aria-hidden="true">
                €
              </span>
              {rows.length > 2 && (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => setRows(rows.filter((_, i) => i !== n))}
                  aria-label={`Quitar formato ${n + 1}`}
                  title="Quitar formato"
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
          {rows.length < MAX_FORMATS && (
            <button type="button" className={styles.add} onClick={() => setRows([...rows, { label: "", price: "" }])}>
              + Añadir formato
            </button>
          )}
          <p className="muted">Los nombres habituales (Tapa, Ración, Copa, Botella…) se traducen solos en la web.</p>
        </div>
      )}
    </div>
  );
}
