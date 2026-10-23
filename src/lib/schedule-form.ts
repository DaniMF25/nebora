/** Turnos por día que admite el servidor (y que lee el formulario). */
export const MAX_SLOTS_PER_DAY = 6;

/**
 * Huecos de turno que muestra el formulario para un día: los existentes más uno
 * libre (mínimo 2, máximo MAX_SLOTS_PER_DAY). Así nunca se ocultan turnos
 * guardados, que se perderían al guardar.
 */
export function slotFieldsFor(existing: number): number {
  return Math.min(MAX_SLOTS_PER_DAY, Math.max(2, existing + 1));
}

export const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
