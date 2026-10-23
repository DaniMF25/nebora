import "server-only";
import { z } from "zod";
import { findFreeSpot, insidePlan, TABLE_SHAPES, type TableShape } from "@/lib/floor";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export interface DiningTable {
  id: string;
  zoneId: string;
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

export interface Zone {
  id: string;
  name: string;
  position: number;
  planWidth: number;
  planHeight: number;
  tables: DiningTable[];
}

export interface FloorPlan {
  establishmentId: string;
  zones: Zone[];
  /** Plazas (capacidad máxima) de las mesas activas. */
  totalSeats: number;
  activeTables: number;
}

const planSize = z.number().int().min(4).max(40);
const zoneNameSchema = z.string().trim().min(1, "Indica un nombre").max(60);
const tableNameSchema = z.string().trim().min(1, "Indica un nombre").max(20);
const capacity = z.number().int().min(1).max(50);
const cells = z.number().int().min(1).max(8);

export const createZoneSchema = z
  .object({ name: zoneNameSchema, planWidth: planSize.default(16), planHeight: planSize.default(10) })
  .strict();
export const updateZoneSchema = z
  .object({ name: zoneNameSchema.optional(), planWidth: planSize.optional(), planHeight: planSize.optional() })
  .strict();

const tableFields = {
  name: tableNameSchema,
  minCapacity: capacity,
  maxCapacity: capacity,
  shape: z.enum(TABLE_SHAPES),
  width: cells,
  height: cells,
};

export const createTableSchema = z
  .object({
    ...tableFields,
    minCapacity: capacity.default(1),
    shape: z.enum(TABLE_SHAPES).default("square"),
    width: cells.default(2),
    height: cells.default(2),
  })
  .strict()
  .refine((t) => t.maxCapacity >= t.minCapacity, { message: "La capacidad máxima no puede ser menor que la mínima" });

export const updateTableSchema = z
  .object({
    name: tableFields.name.optional(),
    minCapacity: capacity.optional(),
    maxCapacity: capacity.optional(),
    shape: tableFields.shape.optional(),
    width: cells.optional(),
    height: cells.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const moveTableSchema = z
  .object({ x: z.number().int().min(0).max(39), y: z.number().int().min(0).max(39), zoneId: z.string().optional() })
  .strict();

const TABLE_COLUMNS = `id, zone_id AS "zoneId", name, min_capacity AS "minCapacity", max_capacity AS "maxCapacity",
  shape, x, y, width, height, active`;

const UPDATE_COLUMN: Record<string, string> = {
  name: "name",
  minCapacity: "min_capacity",
  maxCapacity: "max_capacity",
  shape: "shape",
  width: "width",
  height: "height",
  active: "active",
  x: "x",
  y: "y",
  zoneId: "zone_id",
};

/** Traduce las restricciones de BD a errores comprensibles. */
function mapFloorError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23P01" && e.constraint === "dining_tables_no_overlap") {
    throw new ConflictError("La mesa se solapa con otra en el plano");
  }
  if (e.code === "23514" && e.constraint === "dining_tables_inside_plan") {
    throw new ValidationError("La mesa queda fuera del plano de la zona");
  }
  if (e.code === "23514" && e.constraint === "zones_fit_tables") {
    throw new ValidationError("El plano no puede ser más pequeño: hay mesas que quedarían fuera");
  }
  if (e.code === "23514" && e.constraint === "dining_tables_capacity_check") {
    throw new ValidationError("La capacidad máxima no puede ser menor que la mínima");
  }
  if (isUniqueViolation(err, "dining_tables_establishment_name_unique")) {
    throw new ConflictError("Ya existe una mesa con ese nombre en el establecimiento");
  }
  if (isUniqueViolation(err, "zones_establishment_name_unique")) {
    throw new ConflictError("Ya existe una zona con ese nombre");
  }
  if (e.code === "23503" && (e.constraint === "dining_tables_zone_fk" || e.constraint === "zones_establishment_fk")) {
    throw new ConflictError("No se puede eliminar: tiene elementos asociados");
  }
  throw err;
}

async function establishmentExists(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

/** Bloquea la zona: serializa cambios de mesas y de tamaño del plano en ella. */
async function lockZone(
  tx: Tx,
  ctx: TenantContext,
  zoneId: string,
): Promise<{ establishment_id: string; plan_width: number; plan_height: number }> {
  if (!isUuid(zoneId)) throw new NotFoundError("Zona no encontrada");
  const { rows } = await tx.query<{ establishment_id: string; plan_width: number; plan_height: number }>(
    "SELECT establishment_id, plan_width, plan_height FROM zones WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [ctx.organizationId, zoneId],
  );
  if (!rows[0]) throw new NotFoundError("Zona no encontrada");
  return rows[0];
}

async function getTableRow(tx: Tx, ctx: TenantContext, tableId: string): Promise<DiningTable> {
  if (!isUuid(tableId)) throw new NotFoundError("Mesa no encontrada");
  const { rows } = await tx.query<DiningTable>(
    `SELECT ${TABLE_COLUMNS} FROM dining_tables WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, tableId],
  );
  if (!rows[0]) throw new NotFoundError("Mesa no encontrada");
  return rows[0];
}

export async function getFloorPlan(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<FloorPlan> {
  requirePermission(ctx, "tables.read");
  await establishmentExists(tx, ctx, establishmentId);
  const zones = await tx.query<Omit<Zone, "tables">>(
    `SELECT id, name, position, plan_width AS "planWidth", plan_height AS "planHeight"
       FROM zones WHERE organization_id = $1 AND establishment_id = $2 ORDER BY position, name`,
    [ctx.organizationId, establishmentId],
  );
  const tables = await tx.query<DiningTable>(
    `SELECT ${TABLE_COLUMNS} FROM dining_tables WHERE organization_id = $1 AND establishment_id = $2 ORDER BY name`,
    [ctx.organizationId, establishmentId],
  );
  const active = tables.rows.filter((t) => t.active);
  return {
    establishmentId,
    zones: zones.rows.map((z) => ({ ...z, tables: tables.rows.filter((t) => t.zoneId === z.id) })),
    totalSeats: active.reduce((sum, t) => sum + t.maxCapacity, 0),
    activeTables: active.length,
  };
}

export async function createZone(tx: Tx, ctx: TenantContext, establishmentId: string, input: unknown): Promise<string> {
  requirePermission(ctx, "tables.manage");
  const d = parseInput(createZoneSchema, input);
  await establishmentExists(tx, ctx, establishmentId);
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO zones (organization_id, establishment_id, name, position, plan_width, plan_height)
       SELECT $1, $2, $3, COALESCE(max(position), 0) + 1, $4, $5 FROM zones WHERE organization_id = $1 AND establishment_id = $2
       RETURNING id`,
      [ctx.organizationId, establishmentId, d.name, d.planWidth, d.planHeight],
    );
    await recordAudit(tx, ctx, { action: "zone.created", entityType: "zone", entityId: rows[0]!.id });
    return rows[0]!.id;
  } catch (err) {
    mapFloorError(err);
  }
}

export async function updateZone(tx: Tx, ctx: TenantContext, zoneId: string, input: unknown): Promise<void> {
  requirePermission(ctx, "tables.manage");
  const d = parseInput(updateZoneSchema, input);
  await lockZone(tx, ctx, zoneId);
  const values: Record<string, unknown> = {};
  if (d.name !== undefined) values.name = d.name;
  if (d.planWidth !== undefined) values.plan_width = d.planWidth;
  if (d.planHeight !== undefined) values.plan_height = d.planHeight;
  const cols = Object.keys(values);
  if (cols.length === 0) return;
  try {
    // Columnas de una lista fija; valores parametrizados.
    await tx.query(
      `UPDATE zones SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")} WHERE organization_id = $1 AND id = $2`,
      [ctx.organizationId, zoneId, ...cols.map((c) => values[c])],
    );
  } catch (err) {
    mapFloorError(err);
  }
  await recordAudit(tx, ctx, { action: "zone.updated", entityType: "zone", entityId: zoneId, metadata: { fields: cols } });
}

export async function deleteZone(tx: Tx, ctx: TenantContext, zoneId: string): Promise<void> {
  requirePermission(ctx, "tables.manage");
  await lockZone(tx, ctx, zoneId);
  const tables = await tx.query("SELECT 1 FROM dining_tables WHERE organization_id = $1 AND zone_id = $2 LIMIT 1", [
    ctx.organizationId,
    zoneId,
  ]);
  if (tables.rowCount) throw new ConflictError("La zona tiene mesas: elimínalas o muévelas antes");
  await tx.query("DELETE FROM zones WHERE organization_id = $1 AND id = $2", [ctx.organizationId, zoneId]);
  await recordAudit(tx, ctx, { action: "zone.deleted", entityType: "zone", entityId: zoneId });
}

/** Crea una mesa en el primer hueco libre del plano de la zona. */
export async function createTable(tx: Tx, ctx: TenantContext, zoneId: string, input: unknown): Promise<DiningTable> {
  requirePermission(ctx, "tables.manage");
  const d = parseInput(createTableSchema, input);
  const zone = await lockZone(tx, ctx, zoneId);
  const occupied = await tx.query<{ x: number; y: number; width: number; height: number }>(
    "SELECT x, y, width, height FROM dining_tables WHERE organization_id = $1 AND zone_id = $2 AND active",
    [ctx.organizationId, zoneId],
  );
  const spot = findFreeSpot(zone.plan_width, zone.plan_height, occupied.rows, d.width, d.height);
  if (!spot) throw new ValidationError("No hay hueco libre en el plano para una mesa de ese tamaño");
  try {
    const { rows } = await tx.query<DiningTable>(
      `INSERT INTO dining_tables (organization_id, establishment_id, zone_id, name, min_capacity, max_capacity, shape, x, y, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${TABLE_COLUMNS}`,
      [ctx.organizationId, zone.establishment_id, zoneId, d.name, d.minCapacity, d.maxCapacity, d.shape, spot.x, spot.y, d.width, d.height],
    );
    await recordAudit(tx, ctx, { action: "table.created", entityType: "dining_table", entityId: rows[0]!.id });
    return rows[0]!;
  } catch (err) {
    mapFloorError(err);
  }
}

async function applyTableUpdate(tx: Tx, ctx: TenantContext, tableId: string, values: Record<string, unknown>): Promise<DiningTable> {
  const fields = Object.keys(values);
  try {
    // Columnas de una lista fija (UPDATE_COLUMN); valores parametrizados.
    const { rows } = await tx.query<DiningTable>(
      `UPDATE dining_tables SET ${fields.map((f, i) => `${UPDATE_COLUMN[f]} = $${i + 3}`).join(", ")}
        WHERE organization_id = $1 AND id = $2 RETURNING ${TABLE_COLUMNS}`,
      [ctx.organizationId, tableId, ...fields.map((f) => values[f])],
    );
    if (!rows[0]) throw new NotFoundError("Mesa no encontrada");
    return rows[0];
  } catch (err) {
    mapFloorError(err);
  }
}

export async function updateTable(tx: Tx, ctx: TenantContext, tableId: string, input: unknown): Promise<DiningTable> {
  requirePermission(ctx, "tables.manage");
  const d = parseInput(updateTableSchema, input);
  const current = await getTableRow(tx, ctx, tableId);
  await lockZone(tx, ctx, current.zoneId);
  const values = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length === 0) return current;
  const updated = await applyTableUpdate(tx, ctx, tableId, values);
  await recordAudit(tx, ctx, {
    action: "table.updated",
    entityType: "dining_table",
    entityId: tableId,
    metadata: { fields: Object.keys(values) },
  });
  return updated;
}

/** Mueve una mesa a (x, y), opcionalmente a otra zona del mismo establecimiento. */
export async function moveTable(tx: Tx, ctx: TenantContext, tableId: string, input: unknown): Promise<DiningTable> {
  requirePermission(ctx, "tables.manage");
  const d = parseInput(moveTableSchema, input);
  const current = await getTableRow(tx, ctx, tableId);
  const targetZoneId = d.zoneId ?? current.zoneId;
  // Bloqueo en orden estable para evitar interbloqueos al cambiar de zona.
  const zoneIds = [...new Set([current.zoneId, targetZoneId])].sort();
  const locked = new Map<string, Awaited<ReturnType<typeof lockZone>>>();
  for (const id of zoneIds) locked.set(id, await lockZone(tx, ctx, id));
  const target = locked.get(targetZoneId)!;
  if (target.establishment_id !== locked.get(current.zoneId)!.establishment_id) {
    throw new ValidationError("La zona de destino es de otro establecimiento");
  }
  if (!insidePlan({ x: d.x, y: d.y, width: current.width, height: current.height }, target.plan_width, target.plan_height)) {
    throw new ValidationError("La mesa queda fuera del plano de la zona");
  }
  const values: Record<string, unknown> = { x: d.x, y: d.y };
  if (targetZoneId !== current.zoneId) values.zoneId = targetZoneId;
  const moved = await applyTableUpdate(tx, ctx, tableId, values);
  await recordAudit(tx, ctx, { action: "table.moved", entityType: "dining_table", entityId: tableId });
  return moved;
}

export async function deleteTable(tx: Tx, ctx: TenantContext, tableId: string): Promise<void> {
  requirePermission(ctx, "tables.manage");
  const current = await getTableRow(tx, ctx, tableId);
  await lockZone(tx, ctx, current.zoneId);
  try {
    await tx.query("DELETE FROM dining_tables WHERE organization_id = $1 AND id = $2", [ctx.organizationId, tableId]);
  } catch (err) {
    mapFloorError(err);
  }
  await recordAudit(tx, ctx, { action: "table.deleted", entityType: "dining_table", entityId: tableId });
}
