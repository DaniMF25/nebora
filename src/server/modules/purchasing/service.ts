import "server-only";
import { z } from "zod";
import { parseEuroCost } from "@/lib/money";
import {
  INPUT_UNITS,
  fromNumericString,
  parseQuantity,
  toBase,
  toNumericString,
  type BaseUnit,
  type InputUnit,
} from "@/lib/quantity";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { establishmentFilter, insertMovement } from "@/server/modules/inventory/service";
import { nameSchema } from "@/server/modules/shared-schemas";
import { isValidLocalDate } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export type OrderStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

export interface OrderSummary {
  id: string;
  number: number;
  supplierName: string;
  warehouseName: string;
  establishmentId: string;
  establishmentName: string;
  status: OrderStatus;
  expectedDate: string | null;
  createdAt: Date;
  /** Céntimos (numeric); null sin permiso costs.read. */
  totalCents: string | null;
}

export interface OrderLine {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  quantityOrdered: string;
  quantityReceived: string;
  /** Céntimos por kg / litro / unidad; null sin permiso costs.read. */
  unitPriceCents: string | null;
  lineTotalCents: string | null;
}

export interface Receipt {
  id: string;
  receivedAt: Date;
  receivedByName: string | null;
  note: string | null;
  lines: { ingredientName: string; baseUnit: BaseUnit; quantity: string }[];
}

export interface OrderDetail extends OrderSummary {
  supplierId: string;
  warehouseId: string;
  notes: string | null;
  sentAt: Date | null;
  lines: OrderLine[];
  receipts: Receipt[];
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const supplierSchema = z
  .object({
    name: nameSchema,
    contactName: optionalText(120),
    email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Correo no válido" })
      .transform((v) => (v === "" ? null : v.toLowerCase()))
      .nullable()
      .optional(),
    phone: optionalText(40),
    notes: optionalText(500),
  })
  .strict();

export const createOrderSchema = z
  .object({
    supplierId: z.string(),
    warehouseId: z.string(),
    expectedDate: z
      .string()
      .refine((v) => v === "" || isValidLocalDate(v), { message: "Fecha no válida" })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    notes: optionalText(500),
  })
  .strict();

const unitEnum = z.enum(Object.keys(INPUT_UNITS) as [InputUnit, ...InputUnit[]]);

export const orderLineSchema = z
  .object({
    ingredientId: z.string(),
    quantity: z.string().trim().min(1),
    unit: unitEnum,
    // Euros por kg / litro / unidad.
    unitPrice: z.string().trim().min(1, "Indica el precio"),
  })
  .strict();

export const receiveSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: z.string(), quantity: z.string().trim(), unit: unitEnum }).strict())
      .max(200),
    note: optionalText(300),
    updateCosts: z.boolean().default(true),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,60}$/, { message: "Clave de idempotencia no válida" }),
  })
  .strict();

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "borrador",
  sent: "enviado",
  partially_received: "recibido parcialmente",
  received: "recibido",
  cancelled: "cancelado",
};

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

const SUPPLIER_COLUMNS = `id, name, contact_name AS "contactName", email, phone, notes, active`;

export async function listSuppliers(tx: Tx, ctx: TenantContext): Promise<Supplier[]> {
  requirePermission(ctx, "purchasing.read");
  const { rows } = await tx.query<Supplier>(
    `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE organization_id = $1 ORDER BY active DESC, name`,
    [ctx.organizationId],
  );
  return rows;
}

export async function createSupplier(tx: Tx, ctx: TenantContext, input: unknown): Promise<Supplier> {
  requirePermission(ctx, "catalog.manage");
  const d = parseInput(supplierSchema, input);
  try {
    const { rows } = await tx.query<Supplier>(
      `INSERT INTO suppliers (organization_id, name, contact_name, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SUPPLIER_COLUMNS}`,
      [ctx.organizationId, d.name, d.contactName ?? null, d.email ?? null, d.phone ?? null, d.notes ?? null],
    );
    await recordAudit(tx, ctx, { action: "supplier.created", entityType: "supplier", entityId: rows[0]!.id });
    return rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err, "suppliers_org_name_unique")) throw new ConflictError("Ya existe un proveedor con ese nombre");
    throw err;
  }
}

export async function setSupplierActive(tx: Tx, ctx: TenantContext, id: string, active: boolean): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  if (!isUuid(id)) throw new NotFoundError();
  const res = await tx.query("UPDATE suppliers SET active = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    id,
    active,
  ]);
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "supplier.updated", entityType: "supplier", entityId: id, metadata: { active } });
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

const LINE_TOTAL_SQL = `(l.quantity_ordered * l.unit_price_cents / CASE i.base_unit WHEN 'unit' THEN 1 ELSE 1000 END)`;

const ORDER_SUMMARY_SQL = `
  SELECT o.id, o.number, s.name AS "supplierName", w.name AS "warehouseName", e.id AS "establishmentId",
         e.name AS "establishmentName",
         o.status, to_char(o.expected_date, 'YYYY-MM-DD') AS "expectedDate", o.created_at AS "createdAt",
         (SELECT round(sum(${LINE_TOTAL_SQL}), 4)::text
            FROM purchase_order_lines l JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
           WHERE l.organization_id = o.organization_id AND l.order_id = o.id) AS "totalCents",
         o.supplier_id AS "supplierId", o.warehouse_id AS "warehouseId", o.notes, o.sent_at AS "sentAt"
    FROM purchase_orders o
    JOIN suppliers s ON s.organization_id = o.organization_id AND s.id = o.supplier_id
    JOIN warehouses w ON w.organization_id = o.organization_id AND w.id = o.warehouse_id
    JOIN establishments e ON e.organization_id = w.organization_id AND e.id = w.establishment_id`;

export async function listOrders(tx: Tx, ctx: TenantContext, establishmentId?: string): Promise<OrderSummary[]> {
  requirePermission(ctx, "purchasing.read");
  const { rows } = await tx.query<OrderSummary>(
    `${ORDER_SUMMARY_SQL} WHERE o.organization_id = $1 AND ($2::uuid IS NULL OR e.id = $2)
      ORDER BY o.number DESC LIMIT 100`,
    [ctx.organizationId, establishmentFilter(establishmentId)],
  );
  const costs = ctx.permissions.has("costs.read");
  return rows.map((r) => ({ ...r, totalCents: costs ? r.totalCents : null }));
}

export async function createOrder(tx: Tx, ctx: TenantContext, input: unknown): Promise<string> {
  requirePermission(ctx, "purchasing.manage");
  const d = parseInput(createOrderSchema, input);
  if (!isUuid(d.supplierId) || !isUuid(d.warehouseId)) throw new NotFoundError();
  const supplier = await tx.query<{ active: boolean }>(
    "SELECT active FROM suppliers WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, d.supplierId],
  );
  if (!supplier.rows[0]) throw new NotFoundError("Proveedor no encontrado");
  if (!supplier.rows[0].active) throw new ValidationError("El proveedor está archivado");
  const wh = await tx.query("SELECT 1 FROM warehouses WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    d.warehouseId,
  ]);
  if (wh.rowCount !== 1) throw new NotFoundError("Almacén no encontrado");

  // Numeración correlativa por organización: bloqueo consultivo de transacción
  // más UNIQUE (organization_id, number) como garantía.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('purchase_orders:' || $1))", [ctx.organizationId]);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO purchase_orders (organization_id, number, supplier_id, warehouse_id, expected_date, notes, created_by_user_id)
     SELECT $1, COALESCE(max(number), 0) + 1, $2, $3, $4, $5, $6 FROM purchase_orders WHERE organization_id = $1
     RETURNING id`,
    [ctx.organizationId, d.supplierId, d.warehouseId, d.expectedDate ?? null, d.notes ?? null, ctx.userId],
  );
  await recordAudit(tx, ctx, { action: "purchase_order.created", entityType: "purchase_order", entityId: rows[0]!.id });
  return rows[0]!.id;
}

async function lockOrder(tx: Tx, ctx: TenantContext, orderId: string): Promise<{ status: OrderStatus; number: number }> {
  if (!isUuid(orderId)) throw new NotFoundError();
  const { rows } = await tx.query<{ status: OrderStatus; number: number }>(
    "SELECT status, number FROM purchase_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [ctx.organizationId, orderId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

function requireStatus(current: OrderStatus, allowed: OrderStatus[], action: string): void {
  if (!allowed.includes(current)) {
    throw new ValidationError(`No se puede ${action} un pedido ${STATUS_LABEL[current]}`);
  }
}

export async function getOrder(tx: Tx, ctx: TenantContext, orderId: string): Promise<OrderDetail> {
  requirePermission(ctx, "purchasing.read");
  if (!isUuid(orderId)) throw new NotFoundError();
  const { rows } = await tx.query<OrderDetail>(`${ORDER_SUMMARY_SQL} WHERE o.organization_id = $1 AND o.id = $2`, [
    ctx.organizationId,
    orderId,
  ]);
  const order = rows[0];
  if (!order) throw new NotFoundError();
  const costs = ctx.permissions.has("costs.read");

  const lines = await tx.query<OrderLine>(
    `SELECT l.id, l.ingredient_id AS "ingredientId", i.name AS "ingredientName", i.base_unit AS "baseUnit",
            l.quantity_ordered::text AS "quantityOrdered",
            COALESCE((SELECT sum(r.quantity) FROM goods_receipt_lines r
                       WHERE r.organization_id = l.organization_id AND r.order_line_id = l.id), 0)::numeric(14,3)::text
              AS "quantityReceived",
            l.unit_price_cents::text AS "unitPriceCents", round(${LINE_TOTAL_SQL}, 4)::text AS "lineTotalCents"
       FROM purchase_order_lines l
       JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
      WHERE l.organization_id = $1 AND l.order_id = $2
      ORDER BY i.name`,
    [ctx.organizationId, orderId],
  );
  const receipts = await tx.query<Receipt & { lines: Receipt["lines"] }>(
    `SELECT g.id, g.received_at AS "receivedAt", u.display_name AS "receivedByName", g.note,
            (SELECT json_agg(json_build_object('ingredientName', i.name, 'baseUnit', i.base_unit,
                                               'quantity', rl.quantity::text) ORDER BY i.name)
               FROM goods_receipt_lines rl
               JOIN purchase_order_lines l ON l.organization_id = rl.organization_id AND l.id = rl.order_line_id
               JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
              WHERE rl.organization_id = g.organization_id AND rl.receipt_id = g.id) AS lines
       FROM goods_receipts g LEFT JOIN users u ON u.id = g.received_by_user_id
      WHERE g.organization_id = $1 AND g.order_id = $2
      ORDER BY g.received_at DESC`,
    [ctx.organizationId, orderId],
  );
  return {
    ...order,
    totalCents: costs ? order.totalCents : null,
    lines: lines.rows.map((l) => (costs ? l : { ...l, unitPriceCents: null, lineTotalCents: null })),
    receipts: receipts.rows.map((r) => ({ ...r, lines: r.lines ?? [] })),
  };
}

/** Añade una línea al borrador o actualiza la existente del mismo ingrediente. */
export async function setOrderLine(tx: Tx, ctx: TenantContext, orderId: string, input: unknown): Promise<void> {
  requirePermission(ctx, "purchasing.manage");
  requirePermission(ctx, "costs.read");
  const d = parseInput(orderLineSchema, input);
  const order = await lockOrder(tx, ctx, orderId);
  requireStatus(order.status, ["draft"], "modificar");
  if (!isUuid(d.ingredientId)) throw new NotFoundError("Ingrediente no encontrado");
  const ing = await tx.query<{ base_unit: BaseUnit; active: boolean }>(
    "SELECT base_unit, active FROM ingredients WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, d.ingredientId],
  );
  const ingredient = ing.rows[0];
  if (!ingredient) throw new NotFoundError("Ingrediente no encontrado");
  if (!ingredient.active) throw new ValidationError("El ingrediente está archivado");
  const amount = parseQuantity(d.quantity);
  const base = amount === null ? null : toBase(amount, d.unit, ingredient.base_unit);
  if (base === null) throw new ValidationError("Cantidad o unidad no válida para este ingrediente");
  const price = parseEuroCost(d.unitPrice);
  if (price === null) throw new ValidationError("Precio no válido (euros, hasta 4 decimales)");

  await tx.query(
    `INSERT INTO purchase_order_lines (organization_id, order_id, ingredient_id, quantity_ordered, unit_price_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id, ingredient_id)
     DO UPDATE SET quantity_ordered = EXCLUDED.quantity_ordered, unit_price_cents = EXCLUDED.unit_price_cents`,
    [ctx.organizationId, orderId, d.ingredientId, toNumericString(base), price],
  );
  await recordAudit(tx, ctx, { action: "purchase_order.line_set", entityType: "purchase_order", entityId: orderId });
}

export async function removeOrderLine(tx: Tx, ctx: TenantContext, orderId: string, lineId: string): Promise<void> {
  requirePermission(ctx, "purchasing.manage");
  const order = await lockOrder(tx, ctx, orderId);
  requireStatus(order.status, ["draft"], "modificar");
  if (!isUuid(lineId)) throw new NotFoundError();
  const res = await tx.query(
    "DELETE FROM purchase_order_lines WHERE organization_id = $1 AND order_id = $2 AND id = $3",
    [ctx.organizationId, orderId, lineId],
  );
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "purchase_order.line_removed", entityType: "purchase_order", entityId: orderId });
}

/** Marca el pedido como enviado. No envía nada al proveedor: no hay integración de correo configurada. */
export async function markOrderSent(tx: Tx, ctx: TenantContext, orderId: string): Promise<void> {
  requirePermission(ctx, "purchasing.manage");
  const order = await lockOrder(tx, ctx, orderId);
  requireStatus(order.status, ["draft"], "enviar");
  const lines = await tx.query("SELECT 1 FROM purchase_order_lines WHERE organization_id = $1 AND order_id = $2 LIMIT 1", [
    ctx.organizationId,
    orderId,
  ]);
  if (lines.rowCount === 0) throw new ValidationError("El pedido no tiene líneas");
  await tx.query("UPDATE purchase_orders SET status = 'sent', sent_at = now() WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    orderId,
  ]);
  await recordAudit(tx, ctx, { action: "purchase_order.sent", entityType: "purchase_order", entityId: orderId });
}

export async function cancelOrder(tx: Tx, ctx: TenantContext, orderId: string): Promise<void> {
  requirePermission(ctx, "purchasing.manage");
  const order = await lockOrder(tx, ctx, orderId);
  requireStatus(order.status, ["draft", "sent"], "cancelar");
  await tx.query("UPDATE purchase_orders SET status = 'cancelled' WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    orderId,
  ]);
  await recordAudit(tx, ctx, { action: "purchase_order.cancelled", entityType: "purchase_order", entityId: orderId });
}

/**
 * Registra una recepción de mercancía: entradas de stock por línea, enlace a
 * los movimientos y actualización del estado del pedido, todo en una
 * transacción con el pedido bloqueado. Con la misma clave, un reintento
 * devuelve la recepción existente sin volver a aplicarla.
 */
export async function receiveOrder(
  tx: Tx,
  ctx: TenantContext,
  orderId: string,
  input: unknown,
): Promise<{ receiptId: string; replayed: boolean; status: OrderStatus }> {
  requirePermission(ctx, "purchasing.receive");
  const d = parseInput(receiveSchema, input);
  const order = await lockOrder(tx, ctx, orderId);

  const existing = await tx.query<{ id: string; order_id: string }>(
    "SELECT id, order_id FROM goods_receipts WHERE organization_id = $1 AND idempotency_key = $2",
    [ctx.organizationId, d.idempotencyKey],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].order_id !== orderId) throw new ConflictError("Esa clave ya se usó en otra recepción");
    return { receiptId: existing.rows[0].id, replayed: true, status: order.status };
  }
  requireStatus(order.status, ["sent", "partially_received"], "recibir");

  const { rows: lines } = await tx.query<{
    id: string;
    ingredient_id: string;
    base_unit: BaseUnit;
    ordered: string;
    received: string;
    unit_price_cents: string;
  }>(
    `SELECT l.id, l.ingredient_id, i.base_unit, l.quantity_ordered::text AS ordered,
            COALESCE((SELECT sum(r.quantity) FROM goods_receipt_lines r
                       WHERE r.organization_id = l.organization_id AND r.order_line_id = l.id), 0)::numeric(14,3)::text AS received,
            l.unit_price_cents::text AS unit_price_cents
       FROM purchase_order_lines l JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
      WHERE l.organization_id = $1 AND l.order_id = $2`,
    [ctx.organizationId, orderId],
  );
  const byId = new Map(lines.map((l) => [l.id, l]));

  const toReceive: { line: (typeof lines)[number]; qty: bigint }[] = [];
  const seen = new Set<string>();
  for (const item of d.lines) {
    if (item.quantity === "" || item.quantity === "0") continue;
    const line = byId.get(item.lineId);
    if (!line || seen.has(item.lineId)) throw new NotFoundError("Línea de pedido no encontrada");
    seen.add(item.lineId);
    const amount = parseQuantity(item.quantity);
    const qty = amount === null ? null : toBase(amount, item.unit, line.base_unit);
    if (qty === null) throw new ValidationError("Cantidad o unidad no válida");
    const remaining = fromNumericString(line.ordered) - fromNumericString(line.received);
    if (qty > remaining) throw new ValidationError("No se puede recibir más de lo pendiente en una línea");
    toReceive.push({ line, qty });
  }
  if (toReceive.length === 0) throw new ValidationError("Indica al menos una cantidad recibida");

  const receipt = await tx.query<{ id: string }>(
    `INSERT INTO goods_receipts (organization_id, order_id, idempotency_key, note, received_by_user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ctx.organizationId, orderId, d.idempotencyKey, d.note ?? null, ctx.userId],
  );
  const receiptId = receipt.rows[0]!.id;
  const warehouse = await tx.query<{ warehouse_id: string }>(
    "SELECT warehouse_id FROM purchase_orders WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, orderId],
  );

  for (const { line, qty } of toReceive) {
    const { movement } = await insertMovement(tx, ctx, {
      warehouseId: warehouse.rows[0]!.warehouse_id,
      ingredientId: line.ingredient_id,
      kind: "receipt",
      delta: toNumericString(qty),
      note: `Recepción del pedido ${order.number}`,
      idempotencyKey: `${d.idempotencyKey}:${line.id}`,
      correctsMovementId: null,
    });
    await tx.query(
      `INSERT INTO goods_receipt_lines (organization_id, receipt_id, order_line_id, quantity, movement_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [ctx.organizationId, receiptId, line.id, toNumericString(qty), movement.id],
    );
    if (d.updateCosts) {
      // Último precio de compra como coste de referencia del ingrediente.
      await tx.query(
        `UPDATE ingredients SET cost_cents_per_ref = $3, cost_updated_at = now()
          WHERE organization_id = $1 AND id = $2`,
        [ctx.organizationId, line.ingredient_id, line.unit_price_cents],
      );
    }
  }

  const fully = lines.every((l) => {
    const now = toReceive.find((r) => r.line.id === l.id)?.qty ?? 0n;
    return fromNumericString(l.received) + now >= fromNumericString(l.ordered);
  });
  const status: OrderStatus = fully ? "received" : "partially_received";
  await tx.query("UPDATE purchase_orders SET status = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    orderId,
    status,
  ]);
  await recordAudit(tx, ctx, {
    action: "purchase_order.received",
    entityType: "purchase_order",
    entityId: orderId,
    metadata: { receiptId, lines: toReceive.length, status },
  });
  return { receiptId, replayed: false, status };
}
