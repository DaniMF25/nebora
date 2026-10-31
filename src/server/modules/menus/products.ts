import "server-only";
import { z } from "zod";
import { MAX_FORMAT_LABEL, MAX_FORMATS, MIN_FORMATS, type PriceFormat } from "@/lib/price-formats";
import { ALLERGENS, type Allergen } from "@/lib/allergens";
import { recordAudit } from "@/server/audit/audit";
import { storeImage } from "@/server/modules/media/service";
import type { Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
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
  /** Formatos de venta (D-038); null = precio único. Con formatos, priceCents es el más bajo. */
  formats: PriceFormat[] | null;
  /** Disponible en todos los locales o solo en `establishmentIds` (D-032). */
  allEstablishments: boolean;
  establishmentIds: string[];
}

const descriptionSchema = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const priceCentsSchema = z.number().int().min(0).max(MAX_PRICE_CENTS);

/** De 2 a 6 formatos con nombres distintos; null = precio único. */
const formatsSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(1, "Cada formato necesita un nombre").max(MAX_FORMAT_LABEL),
        priceCents: priceCentsSchema,
      })
      .strict(),
  )
  .min(MIN_FORMATS, `Indica al menos ${MIN_FORMATS} formatos o usa un precio único`)
  .max(MAX_FORMATS, `Como máximo ${MAX_FORMATS} formatos`)
  .refine(
    (f) => new Set(f.map((x) => x.label.toLocaleLowerCase("es"))).size === f.length,
    "Hay formatos con el mismo nombre",
  )
  .nullable();

const allergensSchema = z
  .array(z.enum(ALLERGENS))
  .max(ALLERGENS.length)
  .transform((a) => [...new Set(a)].sort());

export const createProductSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    priceCents: priceCentsSchema,
    formats: formatsSchema.optional(),
    allergens: allergensSchema.default([]),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    priceCents: priceCentsSchema.optional(),
    formats: formatsSchema.optional(),
    allergens: allergensSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const COLUMNS = `id, name, description, price_cents AS "priceCents", formats, allergens, active,
  image_media_id AS "imageMediaId", all_establishments AS "allEstablishments",
  coalesce((SELECT array_agg(pe.establishment_id ORDER BY pe.establishment_id) FROM product_establishments pe
             WHERE pe.organization_id = menu_products.organization_id AND pe.product_id = menu_products.id), '{}')
    AS "establishmentIds"`;
const COLUMN_BY_FIELD = {
  name: "name",
  description: "description",
  priceCents: "price_cents",
  formats: "formats",
  allergens: "allergens",
  active: "active",
} as const;

/** Productos del catálogo; con `availableIn`, solo los disponibles en ese local. */
export async function listProducts(
  tx: Tx,
  ctx: TenantContext,
  options: { activeOnly?: boolean; availableIn?: string } = {},
): Promise<Product[]> {
  requirePermission(ctx, "menus.read");
  if (options.availableIn !== undefined && !isUuid(options.availableIn)) throw new NotFoundError();
  const { rows } = await tx.query<Product>(
    `SELECT ${COLUMNS} FROM menu_products
      WHERE organization_id = $1 AND ($2::boolean IS FALSE OR active)
        AND ($3::uuid IS NULL OR all_establishments OR EXISTS (
              SELECT 1 FROM product_establishments pe
               WHERE pe.organization_id = menu_products.organization_id AND pe.product_id = menu_products.id
                 AND pe.establishment_id = $3))
      ORDER BY active DESC, name`,
    [ctx.organizationId, options.activeOnly ?? false, options.availableIn ?? null],
  );
  return rows;
}

const availabilitySchema = z
  .object({
    allEstablishments: z.boolean(),
    establishmentIds: z.array(z.string().uuid("Local no válido")).max(200).default([]),
  })
  .strict();

/**
 * Locales en los que se ofrece el producto. No se puede retirar de un local
 * mientras esté en alguna de sus cartas (borrador): hay que quitarlo antes.
 */
export async function setProductEstablishments(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  const data = parseInput(availabilitySchema, input);
  await getProduct(tx, ctx, id);
  await tx.query("SELECT 1 FROM menu_products WHERE organization_id = $1 AND id = $2 FOR UPDATE", [
    ctx.organizationId,
    id,
  ]);
  const ids = data.allEstablishments ? [] : [...new Set(data.establishmentIds)];
  if (!data.allEstablishments) {
    if (ids.length === 0) throw new ValidationError("Elige al menos un local");
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM establishments WHERE organization_id = $1 AND id = ANY ($2::uuid[])",
      [ctx.organizationId, ids],
    );
    if (rows[0]!.n !== ids.length) throw new NotFoundError("Local no encontrado");
    const { rows: used } = await tx.query<{ menu: string; establishment: string }>(
      `SELECT DISTINCT m.name AS menu, e.name AS establishment
         FROM menu_items i
         JOIN menu_sections s ON s.organization_id = i.organization_id AND s.id = i.section_id
         JOIN menus m ON m.organization_id = s.organization_id AND m.id = s.menu_id
         JOIN establishments e ON e.organization_id = m.organization_id AND e.id = m.establishment_id
        WHERE i.organization_id = $1 AND i.product_id = $2 AND NOT (m.establishment_id = ANY ($3::uuid[]))
        ORDER BY e.name, m.name`,
      [ctx.organizationId, id, ids],
    );
    if (used.length > 0) {
      throw new ConflictError(
        `El producto está en ${used.map((u) => `«${u.menu}» (${u.establishment})`).join(", ")}: quítalo de esas cartas antes`,
      );
    }
  }
  await tx.query("UPDATE menu_products SET all_establishments = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    id,
    data.allEstablishments,
  ]);
  await tx.query("DELETE FROM product_establishments WHERE organization_id = $1 AND product_id = $2", [
    ctx.organizationId,
    id,
  ]);
  if (ids.length > 0) {
    await tx.query(
      `INSERT INTO product_establishments (organization_id, product_id, establishment_id)
       SELECT $1, $2, unnest($3::uuid[])`,
      [ctx.organizationId, id, ids],
    );
  }
  await recordAudit(tx, ctx, {
    action: "product.availability_changed",
    entityType: "product",
    entityId: id,
    metadata: { establishments: data.allEstablishments ? "all" : ids.length },
  });
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

/** Con formatos, el precio del producto es el más bajo («desde»). */
function withFormatPrice<T extends { priceCents?: number; formats?: PriceFormat[] | null }>(data: T): T {
  if (!data.formats) return data;
  return { ...data, priceCents: Math.min(...data.formats.map((f) => f.priceCents)) };
}

const jsonOrNull = (v: unknown) => (v ? JSON.stringify(v) : null);

export async function createProduct(tx: Tx, ctx: TenantContext, input: unknown): Promise<Product> {
  requirePermission(ctx, "catalog.manage");
  const data = withFormatPrice(parseInput(createProductSchema, input));
  const { rows } = await tx.query<Product>(
    `INSERT INTO menu_products (organization_id, name, description, price_cents, formats, allergens)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [
      ctx.organizationId,
      data.name,
      data.description ?? null,
      data.priceCents,
      data.formats ? JSON.stringify(data.formats) : null,
      data.allergens,
    ],
  );
  const product = rows[0]!;
  await recordAudit(tx, ctx, { action: "product.created", entityType: "product", entityId: product.id });
  return product;
}

export async function updateProduct(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<Product> {
  requirePermission(ctx, "catalog.manage");
  if (!isUuid(id)) throw new NotFoundError();
  const data = withFormatPrice(parseInput(updateProductSchema, input));
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (fields.length === 0) return getProduct(tx, ctx, id);
  if (data.priceCents !== undefined && data.formats === undefined && (await getProduct(tx, ctx, id)).formats) {
    throw new ValidationError("Este plato tiene formatos: cambia el precio de cada formato");
  }
  // Columnas de una lista blanca; valores parametrizados.
  const sets = fields.map((f, i) => `${COLUMN_BY_FIELD[f]} = $${i + 3}`).join(", ");
  const { rows } = await tx.query<Product>(
    `UPDATE menu_products SET ${sets} WHERE organization_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [ctx.organizationId, id, ...fields.map((f) => (f === "formats" ? jsonOrNull(data.formats) : (data[f] ?? null)))],
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
