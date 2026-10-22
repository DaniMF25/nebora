import "server-only";
import { z } from "zod";
import {
  BASE_UNITS,
  INPUT_UNITS,
  parseQuantity,
  toBase,
  toNumericString,
  type BaseUnit,
  type InputUnit,
} from "@/lib/quantity";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { nameSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export interface Ingredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  reorderLevel: string | null;
  active: boolean;
}

export interface Warehouse {
  id: string;
  establishmentId: string;
  establishmentName: string;
  name: string;
}

export interface StockLine {
  warehouseId: string;
  warehouseName: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  quantity: string;
  reorderLevel: string | null;
  belowReorder: boolean;
}

export const MOVEMENT_KINDS = ["receipt", "consumption", "waste", "adjustment"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number] | "correction";

export interface Movement {
  id: string;
  warehouseId: string;
  warehouseName: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  kind: MovementKind;
  quantityDelta: string;
  note: string | null;
  correctsMovementId: string | null;
  correctedByMovementId: string | null;
  createdByName: string | null;
  createdAt: Date;
}

const quantityText = z.string().trim().min(1, "Indica una cantidad");
const noteSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
// La clave la genera el cliente por envío de formulario (o el integrador) y
// permite reintentar sin duplicar el movimiento.
const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, { message: "Clave de idempotencia no válida" });

export const createIngredientSchema = z
  .object({ name: nameSchema, baseUnit: z.enum(BASE_UNITS), reorderLevel: quantityText.optional() })
  .strict();
export const updateIngredientSchema = z
  .object({
    name: nameSchema.optional(),
    reorderLevel: quantityText.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const createWarehouseSchema = z.object({ name: nameSchema }).strict();
export const recordMovementSchema = z
  .object({
    warehouseId: z.string(),
    ingredientId: z.string(),
    kind: z.enum(MOVEMENT_KINDS),
    quantity: quantityText,
    unit: z.enum(Object.keys(INPUT_UNITS) as [InputUnit, ...InputUnit[]]),
    // Solo para ajustes: sentido del ajuste.
    direction: z.enum(["increase", "decrease"]).optional(),
    note: noteSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const correctMovementSchema = z.object({ note: noteSchema, idempotencyKey: idempotencyKeySchema }).strict();

function reorderToNumeric(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const t = parseQuantity(value);
  if (t === null) throw new ValidationError("Nivel de reposición no válido");
  return toNumericString(t);
}

// ---------------------------------------------------------------------------
// Ingredientes y almacenes
// ---------------------------------------------------------------------------

const INGREDIENT_COLUMNS = `id, name, base_unit AS "baseUnit", reorder_level::text AS "reorderLevel", active`;

export async function listIngredients(tx: Tx, ctx: TenantContext): Promise<Ingredient[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<Ingredient>(
    `SELECT ${INGREDIENT_COLUMNS} FROM ingredients WHERE organization_id = $1 ORDER BY active DESC, name`,
    [ctx.organizationId],
  );
  return rows;
}

export async function createIngredient(tx: Tx, ctx: TenantContext, input: unknown): Promise<Ingredient> {
  requirePermission(ctx, "inventory.manage");
  const data = parseInput(createIngredientSchema, input);
  try {
    const { rows } = await tx.query<Ingredient>(
      `INSERT INTO ingredients (organization_id, name, base_unit, reorder_level)
       VALUES ($1, $2, $3, $4) RETURNING ${INGREDIENT_COLUMNS}`,
      [ctx.organizationId, data.name, data.baseUnit, reorderToNumeric(data.reorderLevel)],
    );
    await recordAudit(tx, ctx, { action: "ingredient.created", entityType: "ingredient", entityId: rows[0]!.id });
    return rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err, "ingredients_org_name_unique")) throw new ConflictError("Ya existe un ingrediente con ese nombre");
    throw err;
  }
}

export async function updateIngredient(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<void> {
  requirePermission(ctx, "inventory.manage");
  if (!isUuid(id)) throw new NotFoundError();
  const data = parseInput(updateIngredientSchema, input);
  const values: Record<string, unknown> = {};
  if (data.name !== undefined) values.name = data.name;
  if (data.reorderLevel !== undefined) values.reorder_level = reorderToNumeric(data.reorderLevel);
  if (data.active !== undefined) values.active = data.active;
  const cols = Object.keys(values);
  if (cols.length === 0) return;
  try {
    // Columnas de una lista fija; valores parametrizados.
    const res = await tx.query(
      `UPDATE ingredients SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")}
        WHERE organization_id = $1 AND id = $2`,
      [ctx.organizationId, id, ...cols.map((c) => values[c])],
    );
    if (res.rowCount !== 1) throw new NotFoundError();
  } catch (err) {
    if (isUniqueViolation(err, "ingredients_org_name_unique")) throw new ConflictError("Ya existe un ingrediente con ese nombre");
    throw err;
  }
  await recordAudit(tx, ctx, { action: "ingredient.updated", entityType: "ingredient", entityId: id, metadata: { fields: cols } });
}

export async function listWarehouses(tx: Tx, ctx: TenantContext): Promise<Warehouse[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<Warehouse>(
    `SELECT w.id, w.establishment_id AS "establishmentId", e.name AS "establishmentName", w.name
       FROM warehouses w JOIN establishments e ON e.organization_id = w.organization_id AND e.id = w.establishment_id
      WHERE w.organization_id = $1 ORDER BY e.name, w.name`,
    [ctx.organizationId],
  );
  return rows;
}

export async function createWarehouse(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<string> {
  requirePermission(ctx, "inventory.manage");
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const data = parseInput(createWarehouseSchema, input);
  const est = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (est.rowCount !== 1) throw new NotFoundError();
  try {
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO warehouses (organization_id, establishment_id, name) VALUES ($1, $2, $3) RETURNING id",
      [ctx.organizationId, establishmentId, data.name],
    );
    await recordAudit(tx, ctx, { action: "warehouse.created", entityType: "warehouse", entityId: rows[0]!.id });
    return rows[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err, "warehouses_establishment_name_unique")) {
      throw new ConflictError("Ya existe un almacén con ese nombre en el establecimiento");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stock y movimientos
// ---------------------------------------------------------------------------

export async function listStock(tx: Tx, ctx: TenantContext): Promise<StockLine[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<StockLine>(
    `SELECT l.warehouse_id AS "warehouseId", w.name AS "warehouseName", l.ingredient_id AS "ingredientId",
            i.name AS "ingredientName", i.base_unit AS "baseUnit", l.quantity::text AS quantity,
            i.reorder_level::text AS "reorderLevel",
            (i.reorder_level IS NOT NULL AND l.quantity < i.reorder_level) AS "belowReorder"
       FROM stock_levels l
       JOIN warehouses w ON w.organization_id = l.organization_id AND w.id = l.warehouse_id
       JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
      WHERE l.organization_id = $1
      ORDER BY w.name, i.name`,
    [ctx.organizationId],
  );
  return rows;
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.warehouse_id AS "warehouseId", w.name AS "warehouseName", m.ingredient_id AS "ingredientId",
         i.name AS "ingredientName", i.base_unit AS "baseUnit", m.kind, m.quantity_delta::text AS "quantityDelta",
         m.note, m.corrects_movement_id AS "correctsMovementId",
         (SELECT c.id FROM stock_movements c WHERE c.organization_id = m.organization_id AND c.corrects_movement_id = m.id)
           AS "correctedByMovementId",
         u.display_name AS "createdByName", m.created_at AS "createdAt"
    FROM stock_movements m
    JOIN warehouses w ON w.organization_id = m.organization_id AND w.id = m.warehouse_id
    JOIN ingredients i ON i.organization_id = m.organization_id AND i.id = m.ingredient_id
    LEFT JOIN users u ON u.id = m.created_by_user_id`;

export async function listMovements(tx: Tx, ctx: TenantContext, limit = 50): Promise<Movement[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<Movement>(
    `${MOVEMENT_SELECT} WHERE m.organization_id = $1 ORDER BY m.created_at DESC, m.id LIMIT $2`,
    [ctx.organizationId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
}

async function getMovement(tx: Tx, ctx: TenantContext, id: string): Promise<Movement | null> {
  const { rows } = await tx.query<Movement>(`${MOVEMENT_SELECT} WHERE m.organization_id = $1 AND m.id = $2`, [
    ctx.organizationId,
    id,
  ]);
  return rows[0] ?? null;
}

interface NewMovement {
  warehouseId: string;
  ingredientId: string;
  kind: MovementKind;
  delta: string;
  note: string | null;
  idempotencyKey: string;
  correctsMovementId: string | null;
}

/**
 * Inserta un movimiento de forma idempotente. Si la clave ya se usó con los
 * mismos datos devuelve el movimiento existente (replayed = true) sin volver a
 * aplicarlo; si se usó con datos distintos, es un conflicto. El saldo lo
 * actualiza el trigger de BD; si quedaría negativo, la transacción falla.
 */
async function insertMovement(
  tx: Tx,
  ctx: TenantContext,
  m: NewMovement,
): Promise<{ movement: Movement; replayed: boolean }> {
  let insertedId: string | undefined;
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO stock_movements
         (organization_id, warehouse_id, ingredient_id, kind, quantity_delta, note, idempotency_key,
          corrects_movement_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [ctx.organizationId, m.warehouseId, m.ingredientId, m.kind, m.delta, m.note, m.idempotencyKey,
        m.correctsMovementId, ctx.userId],
    );
    insertedId = rows[0]?.id;
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === "23514" && e.constraint === "stock_levels_non_negative") {
      throw new ValidationError("Stock insuficiente para este movimiento");
    }
    if (isUniqueViolation(err, "stock_movements_single_correction")) {
      throw new ConflictError("Ese movimiento ya fue corregido");
    }
    throw err;
  }

  if (insertedId) {
    await recordAudit(tx, ctx, {
      action: m.kind === "correction" ? "stock.corrected" : "stock.moved",
      entityType: "stock_movement",
      entityId: insertedId,
      metadata: { kind: m.kind, delta: m.delta },
    });
    return { movement: (await getMovement(tx, ctx, insertedId))!, replayed: false };
  }

  // Clave ya usada: comparar con lo registrado.
  const { rows } = await tx.query<{ id: string; same: boolean }>(
    `SELECT id, (warehouse_id = $3 AND ingredient_id = $4 AND kind = $5 AND quantity_delta = $6::numeric
                 AND corrects_movement_id IS NOT DISTINCT FROM $7::uuid) AS same
       FROM stock_movements WHERE organization_id = $1 AND idempotency_key = $2`,
    [ctx.organizationId, m.idempotencyKey, m.warehouseId, m.ingredientId, m.kind, m.delta, m.correctsMovementId],
  );
  const existing = rows[0];
  if (!existing) throw new ConflictError("No se pudo registrar el movimiento; inténtalo de nuevo");
  if (!existing.same) throw new ConflictError("Esa clave de idempotencia ya se usó para otro movimiento");
  return { movement: (await getMovement(tx, ctx, existing.id))!, replayed: true };
}

export async function recordMovement(
  tx: Tx,
  ctx: TenantContext,
  input: unknown,
): Promise<{ movement: Movement; replayed: boolean }> {
  requirePermission(ctx, "inventory.move");
  const data = parseInput(recordMovementSchema, input);
  if (!isUuid(data.warehouseId) || !isUuid(data.ingredientId)) throw new NotFoundError();

  const wh = await tx.query("SELECT 1 FROM warehouses WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    data.warehouseId,
  ]);
  if (wh.rowCount !== 1) throw new NotFoundError("Almacén no encontrado");
  const ing = await tx.query<{ base_unit: BaseUnit; active: boolean }>(
    "SELECT base_unit, active FROM ingredients WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, data.ingredientId],
  );
  const ingredient = ing.rows[0];
  if (!ingredient) throw new NotFoundError("Ingrediente no encontrado");
  if (!ingredient.active) throw new ValidationError("El ingrediente está archivado");

  const amount = parseQuantity(data.quantity);
  if (amount === null) throw new ValidationError("Cantidad no válida (positiva, hasta 3 decimales)");
  const base = toBase(amount, data.unit, ingredient.base_unit);
  if (base === null) throw new ValidationError("La unidad no es compatible con el ingrediente o la cantidad es excesiva");
  if (base < 1n) throw new ValidationError("Cantidad demasiado pequeña");

  let sign: 1n | -1n;
  if (data.kind === "receipt") sign = 1n;
  else if (data.kind === "consumption" || data.kind === "waste") sign = -1n;
  else if (data.direction) sign = data.direction === "increase" ? 1n : -1n;
  else throw new ValidationError("Indica si el ajuste aumenta o disminuye el stock");

  return insertMovement(tx, ctx, {
    warehouseId: data.warehouseId,
    ingredientId: data.ingredientId,
    kind: data.kind,
    delta: toNumericString(sign * base),
    note: data.note ?? null,
    idempotencyKey: data.idempotencyKey,
    correctsMovementId: null,
  });
}

/** Anula un movimiento con otro de signo contrario (nunca se edita ni borra el original). */
export async function correctMovement(
  tx: Tx,
  ctx: TenantContext,
  movementId: string,
  input: unknown,
): Promise<{ movement: Movement; replayed: boolean }> {
  requirePermission(ctx, "inventory.manage");
  if (!isUuid(movementId)) throw new NotFoundError();
  const data = parseInput(correctMovementSchema, input);
  const original = await getMovement(tx, ctx, movementId);
  if (!original) throw new NotFoundError();
  if (original.kind === "correction") throw new ValidationError("Una corrección no se puede corregir");
  const delta = original.quantityDelta.startsWith("-") ? original.quantityDelta.slice(1) : `-${original.quantityDelta}`;
  return insertMovement(tx, ctx, {
    warehouseId: original.warehouseId,
    ingredientId: original.ingredientId,
    kind: "correction",
    delta,
    note: data.note ?? null,
    idempotencyKey: data.idempotencyKey,
    correctsMovementId: original.id,
  });
}
