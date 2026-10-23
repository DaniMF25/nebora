"use client";

import { useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { TABLE_SHAPE_LABELS, type TableShape } from "@/lib/floor";
import type { FormState } from "@/lib/form-state";
import styles from "./zone-plan.module.css";

export interface PlanTable {
  id: string;
  name: string;
  minCapacity: number;
  maxCapacity: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
}

interface Props {
  zoneName: string;
  planWidth: number;
  planHeight: number;
  tables: PlanTable[];
  canManage: boolean;
  moveAction: (tableId: string, x: number, y: number) => Promise<FormState>;
}

interface Drag {
  id: string;
  offsetX: number;
  offsetY: number;
  /** Última posición válida durante el arrastre. */
  x: number;
  y: number;
  previous: PlanTable[];
}

/**
 * Plano de una zona. Con permiso de gestión, las mesas se arrastran o se
 * mueven con las flechas del teclado; cada movimiento se valida en el
 * servidor y, si se rechaza, la mesa vuelve a su posición.
 */
export function ZonePlan({ zoneName, planWidth, planHeight, tables: initial, canManage, moveAction }: Props) {
  const [tables, setTables] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const planRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  function cellFromPointer(e: PointerEvent) {
    const rect = planRef.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * planWidth),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * planHeight),
    };
  }

  function clamp(t: PlanTable, x: number, y: number) {
    return {
      x: Math.min(Math.max(0, x), planWidth - t.width),
      y: Math.min(Math.max(0, y), planHeight - t.height),
    };
  }

  function commit(id: string, x: number, y: number, previous: PlanTable[]) {
    const before = previous.find((t) => t.id === id);
    if (!before || (before.x === x && before.y === y)) return;
    setError(null);
    startTransition(async () => {
      const result = await moveAction(id, x, y);
      if (result.error) {
        setTables(previous);
        setError(result.error);
      }
    });
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, t: PlanTable) {
    if (!canManage || pending) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const cell = cellFromPointer(e);
    drag.current = { id: t.id, offsetX: cell.x - t.x, offsetY: cell.y - t.y, x: t.x, y: t.y, previous: tables };
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const t = d.previous.find((o) => o.id === d.id)!;
    const cell = cellFromPointer(e);
    const pos = clamp(t, cell.x - d.offsetX, cell.y - d.offsetY);
    if (pos.x === d.x && pos.y === d.y) return;
    d.x = pos.x;
    d.y = pos.y;
    setTables(d.previous.map((o) => (o.id === d.id ? { ...o, ...pos } : o)));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d) commit(d.id, d.x, d.y, d.previous);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, t: PlanTable) {
    if (!canManage || pending) return;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = delta[e.key];
    if (!step) return;
    e.preventDefault();
    const previous = tables;
    const { x, y } = clamp(t, t.x + step[0], t.y + step[1]);
    setTables(tables.map((o) => (o.id === t.id ? { ...o, x, y } : o)));
    commit(t.id, x, y, previous);
  }

  return (
    <div>
      <div
        ref={planRef}
        className={styles.plan}
        style={{ aspectRatio: `${planWidth} / ${planHeight}`, backgroundSize: `${100 / planWidth}% ${100 / planHeight}%` }}
        role="group"
        aria-label={`Plano de ${zoneName}`}
      >
        {tables.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.table} ${styles[t.shape]} ${t.active ? "" : styles.inactive}`}
            style={{
              left: `${(t.x / planWidth) * 100}%`,
              top: `${(t.y / planHeight) * 100}%`,
              width: `${(t.width / planWidth) * 100}%`,
              height: `${(t.height / planHeight) * 100}%`,
              cursor: canManage ? "grab" : "default",
            }}
            aria-label={`Mesa ${t.name}, ${TABLE_SHAPE_LABELS[t.shape].toLowerCase()}, ${t.minCapacity} a ${t.maxCapacity} personas${t.active ? "" : ", desactivada"}${canManage ? ". Usa las flechas para moverla" : ""}`}
            onPointerDown={(e) => onPointerDown(e, t)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => onKeyDown(e, t)}
          >
            <span className={styles.name}>{t.name}</span>
            <span className={styles.capacity}>
              {t.minCapacity === t.maxCapacity ? t.maxCapacity : `${t.minCapacity}–${t.maxCapacity}`}
            </span>
          </button>
        ))}
      </div>
      <p className={styles.status} aria-live="polite">
        {pending ? "Guardando…" : error ? <span className="alert">{error}</span> : null}
      </p>
    </div>
  );
}
