/**
 * Cálculo puro de horas reservables (sin BD), probado con pruebas unitarias.
 * Instantes en milisegundos UTC; las horas locales las aporta quien llama.
 */

export interface TableCapacity {
  id: string;
  minCapacity: number;
  maxCapacity: number;
}

export interface Busy {
  tableId: string;
  start: number;
  end: number;
}

/**
 * Mesas candidatas para un grupo, por orden de preferencia: primero las que
 * encajan (mínimo ≤ comensales ≤ máximo) y, entre ellas, la de menor
 * capacidad; después las que admiten al grupo aunque superen su mínimo.
 */
export function rankTables(tables: TableCapacity[], party: number): TableCapacity[] {
  return tables
    .filter((t) => t.maxCapacity >= party)
    .sort((a, b) => {
      const fitA = a.minCapacity <= party ? 0 : 1;
      const fitB = b.minCapacity <= party ? 0 : 1;
      return fitA - fitB || a.maxCapacity - b.maxCapacity || a.id.localeCompare(b.id);
    });
}

export function freeTables(candidates: TableCapacity[], busy: Busy[], start: number, end: number): TableCapacity[] {
  return candidates.filter((t) => !busy.some((b) => b.tableId === t.id && b.start < end && start < b.end));
}

export interface SlotQuery {
  /** Intervalos de apertura (ms) que tocan el día. */
  intervals: { start: number; end: number }[];
  /** Inicio y fin del día local (ms): solo se ofrecen inicios dentro del día. */
  dayStart: number;
  dayEnd: number;
  durationMs: number;
  stepMs: number;
  /** Inicio más temprano admitido (ahora + antelación mínima). */
  earliest: number;
  /** Inicio más tardío admitido (límite de días vista). */
  latest: number;
  tables: TableCapacity[];
  busy: Busy[];
  party: number;
}

/** Inicios (ms) en los que el grupo cabe completo en un periodo de apertura y hay alguna mesa libre. */
export function availableStarts(q: SlotQuery): number[] {
  const candidates = rankTables(q.tables, q.party);
  if (candidates.length === 0) return [];
  const starts: number[] = [];
  for (const iv of q.intervals) {
    for (let t = iv.start; t + q.durationMs <= iv.end; t += q.stepMs) {
      if (t < q.dayStart || t >= q.dayEnd || t < q.earliest || t > q.latest) continue;
      if (freeTables(candidates, q.busy, t, t + q.durationMs).length > 0) starts.push(t);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}
