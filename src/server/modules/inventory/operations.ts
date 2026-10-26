import "server-only";
import { z } from "zod";
import { INPUT_UNITS, parseQuantity, toBase, toNumericString, type BaseUnit, type InputUnit } from "@/lib/quantity";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { establishmentFilter, insertMovement } from "./service";

// Traspasos entre almacenes y recuentos físicos (migración 0014, D-025).

const unitSchema = z.enum(Object.keys(INPUT_UNITS) as [InputUnit, ...InputUnit[]]);
const noteSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Convierte una cantidad escrita por el usuario a milésimas de la unidad base. */
function toBaseQuantity(text: string, unit: InputUnit, base: BaseUnit, allowZero: boolean): bigint {
  // En un recuento, 0 es un valor válido (no queda nada).
  if (allowZero && /^0+(?:[.,]0{1,3})?$/.test(text.trim())) {
    if (INPUT_UNITS[unit].base !== base) throw new ValidationError("La unidad no es compatible con el ingrediente");
    return 0n;
  }
  const amount = parseQuantity(text);
  if (amount === null) throw new ValidationError("Cantidad no válida (positiva, hasta 3 decimales)");
  const value = toBase(amount, unit, base);
  if (value === null)
    throw new ValidationError("La unidad no es compatible con el ingrediente o la cantidad es excesiva");
  if (!allowZero && value < 1n) throw new ValidationError("Cantidad demasiado pequeña");
  return value;
}

async function requireWarehouse(tx: Tx, ctx: TenantContext, id: string): Promise<{ name: string }> {
  if (!isUuid(id)) throw new NotFoundError("Almacén no encontrado");
  const { rows } = await tx.query<{ name: string }>(
    "SELECT name FROM warehouses WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, id],
  );
  if (!rows[0]) throw new NotFoundError("Almacén no encontrado");
  return rows[0];
}

// ---------------------------------------------------------------------------
// Traspasos
// ---------------------------------------------------------------------------

export const transferSchema = z
  .object({
    fromWarehouseId: z.string(),
    toWarehouseId: z.string(),
    ingredientId: z.string(),
    quantity: z.string().trim().min(1, "Indica una cantidad"),
    unit: unitSchema,
    note: noteSchema,
    // Las patas usan la clave con sufijo, por eso el máximo es menor que en los movimientos.
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,90}$/, { message: "Clave de idempotencia no válida" }),
  })
  .strict();

export interface Transfer {
  id: string;
  fromWarehouseName: string;
  fromEstablishmentName: string;
  toWarehouseName: string;
  toEstablishmentName: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  quantity: string;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
}

/**
 * Mueve stock de un almacén a otro de la organización: salida y entrada en la
 * misma transacción (la BD exige ambas patas). Idempotente por clave.
 */
export async function transferStock(
  tx: Tx,
  ctx: TenantContext,
  input: unknown,
): Promise<{ transferId: string; replayed: boolean }> {
  requirePermission(ctx, "inventory.move");
  const data = parseInput(transferSchema, input);
  if (data.fromWarehouseId === data.toWarehouseId) {
    throw new ValidationError("El almacén de origen y el de destino deben ser distintos");
  }
  await requireWarehouse(tx, ctx, data.fromWarehouseId);
  await requireWarehouse(tx, ctx, data.toWarehouseId);
  if (!isUuid(data.ingredientId)) throw new NotFoundError("Ingrediente no encontrado");
  const ing = await tx.query<{ base_unit: BaseUnit; active: boolean }>(
    "SELECT base_unit, active FROM ingredients WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, data.ingredientId],
  );
  const ingredient = ing.rows[0];
  if (!ingredient) throw new NotFoundError("Ingrediente no encontrado");
  if (!ingredient.active) throw new ValidationError("El ingrediente está archivado");
  const quantity = toNumericString(toBaseQuantity(data.quantity, data.unit, ingredient.base_unit, false));

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO stock_transfers
       (organization_id, from_warehouse_id, to_warehouse_id, ingredient_id, quantity, note, idempotency_key,
        created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      ctx.organizationId,
      data.fromWarehouseId,
      data.toWarehouseId,
      data.ingredientId,
      quantity,
      data.note ?? null,
      data.idempotencyKey,
      ctx.userId,
    ],
  );
  const transferId = inserted.rows[0]?.id;
  if (!transferId) {
    const { rows } = await tx.query<{ id: string; same: boolean }>(
      `SELECT id, (from_warehouse_id = $3 AND to_warehouse_id = $4 AND ingredient_id = $5 AND quantity = $6::numeric) AS same
         FROM stock_transfers WHERE organization_id = $1 AND idempotency_key = $2`,
      [ctx.organizationId, data.idempotencyKey, data.fromWarehouseId, data.toWarehouseId, data.ingredientId, quantity],
    );
    if (!rows[0]?.same) throw new ConflictError("Esa clave de idempotencia ya se usó para otro traspaso");
    return { transferId: rows[0].id, replayed: true };
  }

  const leg = { ingredientId: data.ingredientId, note: data.note ?? null, correctsMovementId: null, transferId };
  await insertMovement(tx, ctx, {
    ...leg,
    warehouseId: data.fromWarehouseId,
    kind: "transfer_out",
    delta: `-${quantity}`,
    idempotencyKey: `${data.idempotencyKey}-out`,
  });
  await insertMovement(tx, ctx, {
    ...leg,
    warehouseId: data.toWarehouseId,
    kind: "transfer_in",
    delta: quantity,
    idempotencyKey: `${data.idempotencyKey}-in`,
  });
  await recordAudit(tx, ctx, {
    action: "stock.transferred",
    entityType: "stock_transfer",
    entityId: transferId,
    metadata: { quantity },
  });
  return { transferId, replayed: false };
}

/** Traspasos recientes; con establecimiento, los que salen de él o llegan a él. */
export async function listTransfers(
  tx: Tx,
  ctx: TenantContext,
  limit = 20,
  establishmentId?: string,
): Promise<Transfer[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<Transfer>(
    `SELECT t.id, f.name AS "fromWarehouseName", fe.name AS "fromEstablishmentName",
            d.name AS "toWarehouseName", de.name AS "toEstablishmentName", i.name AS "ingredientName",
            i.base_unit AS "baseUnit", t.quantity::text AS quantity, t.note, u.display_name AS "createdByName",
            t.created_at AS "createdAt"
       FROM stock_transfers t
       JOIN warehouses f ON f.organization_id = t.organization_id AND f.id = t.from_warehouse_id
       JOIN warehouses d ON d.organization_id = t.organization_id AND d.id = t.to_warehouse_id
       JOIN establishments fe ON fe.organization_id = f.organization_id AND fe.id = f.establishment_id
       JOIN establishments de ON de.organization_id = d.organization_id AND de.id = d.establishment_id
       JOIN ingredients i ON i.organization_id = t.organization_id AND i.id = t.ingredient_id
       LEFT JOIN users u ON u.id = t.created_by_user_id
      WHERE t.organization_id = $1 AND ($3::uuid IS NULL OR f.establishment_id = $3 OR d.establishment_id = $3)
      ORDER BY t.created_at DESC, t.id
      LIMIT $2`,
    [ctx.organizationId, Math.min(Math.max(limit, 1), 100), establishmentFilter(establishmentId)],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Recuentos físicos
// ---------------------------------------------------------------------------

export type CountStatus = "open" | "applied" | "cancelled";

export interface CountSummary {
  id: string;
  warehouseId: string;
  warehouseName: string;
  establishmentId: string;
  establishmentName: string;
  status: CountStatus;
  note: string | null;
  lineCount: number;
  createdByName: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface CountLine {
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  /** Cantidad contada (unidad base) o null si aún no se ha contado. */
  counted: string | null;
  /**
   * Saldo del sistema al aplicar y diferencia. Solo en recuentos aplicados:
   * mientras está abierto no se muestra, para que el recuento sea «ciego».
   */
  expected: string | null;
  difference: string | null;
}

export interface CountDetail extends CountSummary {
  lines: CountLine[];
}

const COUNT_SELECT = `
  SELECT c.id, c.warehouse_id AS "warehouseId", w.name AS "warehouseName", e.id AS "establishmentId",
         e.name AS "establishmentName",
         c.status, c.note, (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = c.id) AS "lineCount",
         u.display_name AS "createdByName", c.created_at AS "createdAt", c.closed_at AS "closedAt"
    FROM stock_counts c
    JOIN warehouses w ON w.organization_id = c.organization_id AND w.id = c.warehouse_id
    JOIN establishments e ON e.organization_id = w.organization_id AND e.id = w.establishment_id
    LEFT JOIN users u ON u.id = c.created_by_user_id`;

export async function listCounts(
  tx: Tx,
  ctx: TenantContext,
  limit = 20,
  establishmentId?: string,
): Promise<CountSummary[]> {
  requirePermission(ctx, "inventory.read");
  const { rows } = await tx.query<CountSummary>(
    `${COUNT_SELECT} WHERE c.organization_id = $1 AND ($3::uuid IS NULL OR e.id = $3)
      ORDER BY (c.status = 'open') DESC, c.created_at DESC LIMIT $2`,
    [ctx.organizationId, Math.min(Math.max(limit, 1), 100), establishmentFilter(establishmentId)],
  );
  return rows;
}

async function getCountSummary(tx: Tx, ctx: TenantContext, countId: string, lock = false): Promise<CountSummary> {
  if (!isUuid(countId)) throw new NotFoundError();
  if (lock) {
    await tx.query("SELECT 1 FROM stock_counts WHERE organization_id = $1 AND id = $2 FOR UPDATE", [
      ctx.organizationId,
      countId,
    ]);
  }
  const { rows } = await tx.query<CountSummary>(`${COUNT_SELECT} WHERE c.organization_id = $1 AND c.id = $2`, [
    ctx.organizationId,
    countId,
  ]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** Recuento con todas las líneas posibles: ingredientes activos más los ya contados. */
export async function getCount(tx: Tx, ctx: TenantContext, countId: string): Promise<CountDetail> {
  requirePermission(ctx, "inventory.read");
  const summary = await getCountSummary(tx, ctx, countId);
  const showExpected = summary.status === "applied";
  const { rows } = await tx.query<{
    ingredientId: string;
    ingredientName: string;
    baseUnit: BaseUnit;
    counted: string | null;
    expected: string | null;
    difference: string | null;
  }>(
    `SELECT i.id AS "ingredientId", i.name AS "ingredientName", i.base_unit AS "baseUnit",
            l.counted_quantity::text AS counted, l.expected_quantity::text AS expected,
            (l.counted_quantity - l.expected_quantity)::text AS difference
       FROM ingredients i
       LEFT JOIN stock_count_lines l ON l.organization_id = i.organization_id AND l.ingredient_id = i.id
                                    AND l.count_id = $2
      WHERE i.organization_id = $1 AND (i.active OR l.count_id IS NOT NULL)
      ORDER BY i.name`,
    [ctx.organizationId, countId],
  );
  // Un recuento cerrado solo muestra lo contado.
  const lines = (summary.status === "open" ? rows : rows.filter((r) => r.counted !== null)).map((r) => ({
    ...r,
    expected: showExpected ? r.expected : null,
    difference: showExpected ? r.difference : null,
  }));
  return { ...summary, lines };
}

export const openCountSchema = z.object({ warehouseId: z.string(), note: noteSchema }).strict();

export async function openCount(tx: Tx, ctx: TenantContext, input: unknown): Promise<string> {
  requirePermission(ctx, "inventory.move");
  const data = parseInput(openCountSchema, input);
  await requireWarehouse(tx, ctx, data.warehouseId);
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO stock_counts (organization_id, warehouse_id, note, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ctx.organizationId, data.warehouseId, data.note ?? null, ctx.userId],
    );
    const id = rows[0]!.id;
    await recordAudit(tx, ctx, { action: "stock_count.opened", entityType: "stock_count", entityId: id });
    return id;
  } catch (err) {
    if (isUniqueViolation(err, "stock_counts_one_open")) {
      throw new ConflictError("Ya hay un recuento abierto en ese almacén");
    }
    throw err;
  }
}

export const saveCountLinesSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            ingredientId: z.string(),
            // Vacío = sin contar (se elimina la línea si existía).
            quantity: z.string().trim(),
            unit: unitSchema,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

/** Guarda lo contado. Solo con el recuento abierto (también lo exige la BD). */
export async function saveCountLines(tx: Tx, ctx: TenantContext, countId: string, input: unknown): Promise<void> {
  requirePermission(ctx, "inventory.move");
  const data = parseInput(saveCountLinesSchema, input);
  const summary = await getCountSummary(tx, ctx, countId, true);
  if (summary.status !== "open") throw new ConflictError("El recuento ya está cerrado");
  const ids = data.lines.map((l) => l.ingredientId);
  if (new Set(ids).size !== ids.length || !ids.every(isUuid)) throw new ValidationError("Líneas no válidas");
  const ing = await tx.query<{ id: string; base_unit: BaseUnit }>(
    "SELECT id, base_unit FROM ingredients WHERE organization_id = $1 AND id = ANY($2::uuid[])",
    [ctx.organizationId, ids],
  );
  const baseOf = new Map(ing.rows.map((r) => [r.id, r.base_unit]));
  for (const line of data.lines) {
    const base = baseOf.get(line.ingredientId);
    if (!base) throw new NotFoundError("Ingrediente no encontrado");
    if (line.quantity === "") {
      await tx.query(
        "DELETE FROM stock_count_lines WHERE organization_id = $1 AND count_id = $2 AND ingredient_id = $3",
        [ctx.organizationId, countId, line.ingredientId],
      );
      continue;
    }
    const qty = toNumericString(toBaseQuantity(line.quantity, line.unit, base, true));
    await tx.query(
      `INSERT INTO stock_count_lines (organization_id, count_id, ingredient_id, counted_quantity, counted_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (count_id, ingredient_id)
       DO UPDATE SET counted_quantity = EXCLUDED.counted_quantity, counted_by_user_id = EXCLUDED.counted_by_user_id,
                     updated_at = now()`,
      [ctx.organizationId, countId, line.ingredientId, qty, ctx.userId],
    );
  }
  await recordAudit(tx, ctx, {
    action: "stock_count.lines_saved",
    entityType: "stock_count",
    entityId: countId,
    metadata: { lines: data.lines.length },
  });
}

/**
 * Aplica el recuento: ajusta cada artículo contado a la cantidad contada,
 * calculando la diferencia con el saldo bloqueado en ese instante.
 * Devuelve el número de ajustes generados.
 */
export async function applyCount(tx: Tx, ctx: TenantContext, countId: string): Promise<number> {
  requirePermission(ctx, "inventory.manage");
  const summary = await getCountSummary(tx, ctx, countId);
  if (summary.status !== "open") throw new ConflictError("El recuento ya está cerrado");
  if (summary.lineCount === 0) throw new ValidationError("No hay nada contado todavía");
  let changes: number;
  try {
    const { rows } = await tx.query<{ changes: number }>("SELECT app.apply_stock_count($1) AS changes", [countId]);
    changes = rows[0]!.changes;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P0002") throw new ConflictError("El recuento ya está cerrado");
    if (code === "42501") throw new ForbiddenError();
    throw err;
  }
  await recordAudit(tx, ctx, {
    action: "stock_count.applied",
    entityType: "stock_count",
    entityId: countId,
    metadata: { adjustments: changes },
  });
  return changes;
}

export async function cancelCount(tx: Tx, ctx: TenantContext, countId: string): Promise<void> {
  requirePermission(ctx, "inventory.manage");
  const summary = await getCountSummary(tx, ctx, countId, true);
  if (summary.status !== "open") throw new ConflictError("El recuento ya está cerrado");
  await tx.query(
    `UPDATE stock_counts SET status = 'cancelled', closed_at = now(), closed_by_user_id = $3
      WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, countId, ctx.userId],
  );
  await recordAudit(tx, ctx, { action: "stock_count.cancelled", entityType: "stock_count", entityId: countId });
}
