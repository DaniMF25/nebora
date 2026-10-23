import { TABLE_SHAPE_LABELS, type TableShape } from "@/lib/floor";
import styles from "./zone-plan.module.css";

interface Props {
  zoneName: string;
  planWidth: number;
  planHeight: number;
  tables: {
    id: string;
    name: string;
    shape: TableShape;
    x: number;
    y: number;
    width: number;
    height: number;
    maxCapacity: number;
    active: boolean;
  }[];
  occupied: Record<string, { customerName: string; partySize: number }>;
}

/** Plano de solo lectura con las mesas ocupadas en un instante. */
export function OccupancyPlan({ zoneName, planWidth, planHeight, tables, occupied }: Props) {
  return (
    <div
      className={styles.plan}
      style={{ aspectRatio: `${planWidth} / ${planHeight}`, backgroundSize: `${100 / planWidth}% ${100 / planHeight}%` }}
      role="img"
      aria-label={`Ocupación de ${zoneName}: ${tables
        .filter((t) => t.active)
        .map((t) => `mesa ${t.name} ${occupied[t.id] ? `ocupada por ${occupied[t.id]!.customerName}` : "libre"}`)
        .join(", ")}`}
    >
      {tables
        .filter((t) => t.active)
        .map((t) => {
          const occ = occupied[t.id];
          return (
            <div
              key={t.id}
              className={`${styles.table} ${styles[t.shape]} ${occ ? styles.occupied : styles.free}`}
              style={{
                left: `${(t.x / planWidth) * 100}%`,
                top: `${(t.y / planHeight) * 100}%`,
                width: `${(t.width / planWidth) * 100}%`,
                height: `${(t.height / planHeight) * 100}%`,
              }}
              title={`${t.name} (${TABLE_SHAPE_LABELS[t.shape]}, hasta ${t.maxCapacity})`}
            >
              <span className={styles.name}>{t.name}</span>
              <span className={styles.capacity}>{occ ? `${occ.customerName} · ${occ.partySize}` : "Libre"}</span>
            </div>
          );
        })}
    </div>
  );
}
