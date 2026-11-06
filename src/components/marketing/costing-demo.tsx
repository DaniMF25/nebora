"use client";

import { useId, useState } from "react";
import { DEMO_PRICE, DEMO_RECIPE, lineCost } from "./demo-data";
import styles from "./marketing.module.css";

const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const pct = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

/**
 * Escandallo de la demo (D-065): la receta de las croquetas con el mismo
 * cálculo que el panel. Al cambiar el precio del jamón o el de la carta se
 * recalculan el coste, el margen y el porcentaje.
 */
export function CostingDemo() {
  const id = useId();
  const [ham, setHam] = useState(48);
  const [price, setPrice] = useState(DEMO_PRICE);
  const lines = DEMO_RECIPE.map((l) => ({ ...l, cost: lineCost(l, l.name === "Jamón ibérico" ? ham : l.costPerRef) }));
  const cost = lines.reduce((n, l) => n + l.cost, 0);
  const share = (cost / price) * 100;
  const level = share < 30 ? "ok" : share < 35 ? "warn" : "bad";

  return (
    <div className={styles.demo}>
      <div className={styles.costControls}>
        <label>
          <span>Jamón ibérico, precio por kilo</span>
          <span className={styles.costInput}>
            <input
              id={`${id}-jamon`}
              type="range"
              min={30}
              max={80}
              step={1}
              value={ham}
              onChange={(e) => setHam(Number(e.currentTarget.value))}
              aria-valuetext={eur(ham)}
            />
            <output htmlFor={`${id}-jamon`}>{eur(ham)}</output>
          </span>
        </label>
        <label>
          <span>Precio en carta de la ración</span>
          <span className={styles.costInput}>
            <input
              id={`${id}-pvp`}
              type="range"
              min={6}
              max={14}
              step={0.5}
              value={price}
              onChange={(e) => setPrice(Number(e.currentTarget.value))}
              aria-valuetext={eur(price)}
            />
            <output htmlFor={`${id}-pvp`}>{eur(price)}</output>
          </span>
        </label>
      </div>
      <table className={styles.recipe}>
        <caption className="visually-hidden">Receta de las croquetas por ración</caption>
        <thead>
          <tr>
            <th scope="col">Ingrediente</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Coste</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.name}>
              <th scope="row">{l.name}</th>
              <td>
                {l.qty} {l.unit}
              </td>
              <td>{eur(l.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.costResult} aria-live="polite">
        <div>
          <span>Coste</span>
          <strong>{eur(cost)}</strong>
        </div>
        <div>
          <span>Margen</span>
          <strong>{eur(price - cost)}</strong>
        </div>
        <div className={styles[`level_${level}`]}>
          <span>Coste sobre precio</span>
          <strong>{pct(share)}</strong>
        </div>
      </div>
      <div className={styles.costBar} aria-hidden="true">
        <span className={styles[`level_${level}`]} style={{ width: `${Math.min(100, share)}%` }} />
        <i style={{ left: "30%" }} />
        <i style={{ left: "35%" }} />
      </div>
    </div>
  );
}
