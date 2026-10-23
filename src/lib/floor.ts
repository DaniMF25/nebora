/** Geometría del plano de sala en celdas enteras. Rectángulos semiabiertos [x, x+w) × [y, y+h). */

export const TABLE_SHAPES = ["round", "square", "rectangle"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const TABLE_SHAPE_LABELS: Record<TableShape, string> = {
  round: "Redonda",
  square: "Cuadrada",
  rectangle: "Rectangular",
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function insidePlan(r: Rect, planWidth: number, planHeight: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.width <= planWidth && r.y + r.height <= planHeight;
}

/** Primera posición libre (por filas) para un rectángulo de w × h; null si no cabe. */
export function findFreeSpot(
  planWidth: number,
  planHeight: number,
  occupied: Rect[],
  width: number,
  height: number,
): { x: number; y: number } | null {
  for (let y = 0; y + height <= planHeight; y++) {
    for (let x = 0; x + width <= planWidth; x++) {
      const candidate = { x, y, width, height };
      if (!occupied.some((o) => rectsOverlap(candidate, o))) return { x, y };
    }
  }
  return null;
}
