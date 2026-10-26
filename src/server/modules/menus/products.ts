import "server-only";
import { z } from "zod";
import { ALLERGENS, type Allergen } from "@/lib/allergens";
import { recordAudit } from "@/server/audit/audit";
import { storeImage } from "@/server/modules/media/service";
import type { Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError } from "@/server/errors";
import { nameSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export const MAX_PRICE_CENTS = 100_000_000;

export interface Product {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  allergens: Allergen[];
  active: boolean;
  /** Foto del plato (WebP reprocesado), o null. */
  imageMediaId: string | null;
}

const descriptionSchema = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const priceCentsSchema = z.number().int().min(0).max(MAX_PRICE_CENTS);

const allergensSchema = z
  .array(z.enum(ALLERGENS))
  .max(ALLERGENS.length)
  .transform((a) => [...new Set(a)].sort());

export const createProductSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    priceCents: priceCentsSchema,
    allergens: allergensSchema.default([]),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    priceCents: priceCentsSchema.optional(),
    allergens: allergensSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const COLUMNS = `id, name, description, price_cents AS "priceCents", allergens, active,
  image_media_id AS "imageMediaId"`;
const COLUMN_BY_FIELD = {
  name: "name",
  description: "description",
  priceCents: "price_cents",
  allergens: "allergens",
  active: "active",
} as const;

export async function listProducts(tx: Tx, ctx: TenantContext, options: { activeOnly?: boolean } = {}): Promise<Product[]> {
  requirePermission(ctx, "menus.read");
  const { rows } = await tx.query<Product>(
    `SELECT ${COLUMNS} FROM menu_products
      WHERE organization_id = $1 AND ($2::boolean IS FALSE OR active)
      ORDER BY active DESC, name`,
    [ctx.organizationId, options.activeOnly ?? false],
  );
  return rows;
}

export async function getProduct(tx: Tx, ctx: TenantContext, id: string): Promise<Product> {
  requirePermission(ctx, "menus.read");
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<Product>(
    `SELECT ${COLUMNS} FROM menu_products WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, id],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function createProduct(tx: Tx, ctx: TenantContext, input: unknown): Promise<Product> {
  requirePermission(ctx, "catalog.manage");
  const data = parseInput(createProductSchema, input);
  const { rows } = await tx.query<Product>(
    `INSERT INTO menu_products (organization_id, name, description, price_cents, allergens)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [ctx.organizationId, data.name, data.description ?? null, data.priceCents, data.allergens],
  );
  const product = rows[0]!;
  await recordAudit(tx, ctx, { action: "product.created", entityType: "product", entityId: product.id });
  return product;
}

export async function updateProduct(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<Product> {
  requirePermission(ctx, "catalog.manage");
  if (!isUuid(id)) throw new NotFoundError();
  const data = parseInput(updateProductSchema, input);
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (fields.length === 0) return getProduct(tx, ctx, id);
  // Columnas de una lista blanca; valores parametrizados.
  const sets = fields.map((f, i) => `${COLUMN_BY_FIELD[f]} = $${i + 3}`).join(", ");
  const { rows } = await tx.query<Product>(
    `UPDATE menu_products SET ${sets} WHERE organization_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [ctx.organizationId, id, ...fields.map((f) => data[f] ?? null)],
  );
  if (!rows[0]) throw new NotFoundError();
  await recordAudit(tx, ctx, {
    action: "product.updated",
    entityType: "product",
    entityId: id,
    metadata: { fields },
  });
  return rows[0];
}

/** Solo se borran productos que no estén en ningún borrador; si no, se archivan (active = false). */
export async function deleteProduct(tx: Tx, ctx: TenantContext, id: string): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  if (!isUuid(id)) throw new NotFoundError();
  const used = await tx.query("SELECT 1 FROM menu_items WHERE organization_id = $1 AND product_id = $2 LIMIT 1", [
    ctx.organizationId,
    id,
  ]);
  if (used.rowCount) throw new ConflictError("El producto está en una carta: quítalo de ella o archívalo");
  const res = await tx.query("DELETE FROM menu_products WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    id,
  ]);
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "product.deleted", entityType: "product", entityId: id });
}

/**
 * Cambia (o quita, con null) la foto del producto. Las cartas ya publicadas
 * conservan la foto de su versión hasta que se vuelvan a publicar.
 */
export async function setProductImage(tx: Tx, ctx: TenantContext, id: string, bytes: Uint8Array | null): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  await getProduct(tx, ctx, id);
  const image = bytes ? await storeImage(tx, ctx, bytes) : null;
  await tx.query("UPDATE menu_products SET image_media_id = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    id,
    image?.id ?? null,
  ]);
  await recordAudit(tx, ctx, {
    action: image ? "product.image_set" : "product.image_removed",
    entityType: "product",
    entityId: id,
  });
}
