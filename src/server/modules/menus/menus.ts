import "server-only";
import { z } from "zod";
import type { Allergen } from "@/lib/allergens";
import { MENU_THEMES, type MenuSnapshot, type MenuTheme } from "@/lib/menu-snapshot";
import { recordAudit } from "@/server/audit/audit";
import { getPool, isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { nameSchema, slugSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { priceCentsSchema } from "./products";

export const MAX_SECTIONS = 50;
export const MAX_ITEMS_PER_SECTION = 200;

export interface MenuSummary {
  id: string;
  establishmentId: string;
  name: string;
  slug: string;
  theme: MenuTheme;
  /** Código estable para el enlace corto /q/<código> y el QR. */
  publicCode: string;
  publishedVersionNumber: number | null;
  publishedAt: Date | null;
}

export interface DraftItem {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  priceOverrideCents: number | null;
  priceCents: number;
  allergens: Allergen[];
  productActive: boolean;
  imageMediaId: string | null;
  recommended: boolean;
}

export interface DraftSection {
  id: string;
  name: string;
  items: DraftItem[];
}

export interface MenuDraft {
  menu: MenuSummary;
  establishmentName: string;
  establishmentSlug: string;
  organizationSlug: string;
  sections: DraftSection[];
}

export interface MenuVersionSummary {
  id: string;
  versionNumber: number;
  publishedAt: Date;
  publishedByName: string | null;
  isCurrent: boolean;
}

const themeSchema = z.enum(MENU_THEMES);

export const createMenuSchema = z
  .object({ name: nameSchema, slug: slugSchema, theme: themeSchema.default("moderno") })
  .strict();

export const updateMenuSchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.optional(), theme: themeSchema.optional() })
  .strict();

const sectionNameSchema = z.object({ name: nameSchema }).strict();
const addItemSchema = z
  .object({ productId: z.string().uuid(), priceOverrideCents: priceCentsSchema.nullable().optional() })
  .strict();
const itemPriceSchema = z.object({ priceOverrideCents: priceCentsSchema.nullable() }).strict();
const directionSchema = z.enum(["up", "down"]);
const recommendedSchema = z.object({ recommended: z.boolean() }).strict();

const SUMMARY_SQL = `
  SELECT m.id, m.establishment_id AS "establishmentId", m.name, m.slug::text AS slug, m.theme,
         m.public_code AS "publicCode",
         v.version_number AS "publishedVersionNumber", v.published_at AS "publishedAt"
    FROM menus m
    LEFT JOIN menu_versions v ON v.id = m.published_version_id AND v.menu_id = m.id`;

function mapUnique(err: unknown): never {
  if (isUniqueViolation(err, "menus_establishment_slug_unique")) {
    throw new ConflictError("Ya existe una carta con ese identificador en este establecimiento");
  }
  if (isUniqueViolation(err, "menu_items_section_product_unique")) {
    throw new ConflictError("Ese producto ya está en esta categoría");
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Cartas
// ---------------------------------------------------------------------------

export async function listMenus(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<MenuSummary[]> {
  requirePermission(ctx, "menus.read");
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rows } = await tx.query<MenuSummary>(
    `${SUMMARY_SQL} WHERE m.organization_id = $1 AND m.establishment_id = $2 ORDER BY m.name`,
    [ctx.organizationId, establishmentId],
  );
  return rows;
}

export async function createMenu(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<MenuSummary> {
  requirePermission(ctx, "menus.edit");
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const data = parseInput(createMenuSchema, input);
  const est = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (est.rowCount !== 1) throw new NotFoundError();
  let id: string;
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO menus (organization_id, establishment_id, name, slug, theme)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ctx.organizationId, establishmentId, data.name, data.slug, data.theme],
    );
    id = rows[0]!.id;
  } catch (err) {
    mapUnique(err);
  }
  await recordAudit(tx, ctx, { action: "menu.created", entityType: "menu", entityId: id });
  return getMenuSummary(tx, ctx, id);
}

export async function getMenuSummary(tx: Tx, ctx: TenantContext, menuId: string): Promise<MenuSummary> {
  requirePermission(ctx, "menus.read");
  if (!isUuid(menuId)) throw new NotFoundError();
  const { rows } = await tx.query<MenuSummary>(`${SUMMARY_SQL} WHERE m.organization_id = $1 AND m.id = $2`, [
    ctx.organizationId,
    menuId,
  ]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/**
 * Bloquea la carta para modificar su borrador o publicarla. Todas las
 * escrituras de una carta se serializan, de modo que una publicación nunca ve
 * un borrador a medio modificar.
 */
async function lockMenu(tx: Tx, ctx: TenantContext, menuId: string): Promise<void> {
  if (!isUuid(menuId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM menus WHERE organization_id = $1 AND id = $2 FOR UPDATE", [
    ctx.organizationId,
    menuId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

export async function updateMenu(tx: Tx, ctx: TenantContext, menuId: string, input: unknown): Promise<MenuSummary> {
  requirePermission(ctx, "menus.edit");
  const data = parseInput(updateMenuSchema, input);
  await lockMenu(tx, ctx, menuId);
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (fields.length > 0) {
    try {
      // Las columnas coinciden con las claves del esquema estricto (lista blanca).
      const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
      await tx.query(`UPDATE menus SET ${sets} WHERE organization_id = $1 AND id = $2`, [
        ctx.organizationId,
        menuId,
        ...fields.map((f) => data[f]),
      ]);
    } catch (err) {
      mapUnique(err);
    }
    await recordAudit(tx, ctx, { action: "menu.updated", entityType: "menu", entityId: menuId, metadata: { fields } });
  }
  return getMenuSummary(tx, ctx, menuId);
}

export async function deleteMenu(tx: Tx, ctx: TenantContext, menuId: string): Promise<void> {
  requirePermission(ctx, "menus.edit");
  await lockMenu(tx, ctx, menuId);
  // Primero se despublica para no depender del orden de borrado en cascada.
  await tx.query("UPDATE menus SET published_version_id = NULL WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
  ]);
  await tx.query("DELETE FROM menus WHERE organization_id = $1 AND id = $2", [ctx.organizationId, menuId]);
  await recordAudit(tx, ctx, { action: "menu.deleted", entityType: "menu", entityId: menuId });
}

// ---------------------------------------------------------------------------
// Borrador: categorías y elementos
// ---------------------------------------------------------------------------

export async function getMenuDraft(tx: Tx, ctx: TenantContext, menuId: string): Promise<MenuDraft> {
  requirePermission(ctx, "menus.read");
  const menu = await getMenuSummary(tx, ctx, menuId);
  const meta = await tx.query<{ establishment_name: string; establishment_slug: string; organization_slug: string }>(
    `SELECT e.name AS establishment_name, e.slug::text AS establishment_slug, o.slug::text AS organization_slug
       FROM establishments e JOIN organizations o ON o.id = e.organization_id
      WHERE e.organization_id = $1 AND e.id = $2`,
    [ctx.organizationId, menu.establishmentId],
  );
  const sections = await tx.query<{ id: string; name: string }>(
    "SELECT id, name FROM menu_sections WHERE organization_id = $1 AND menu_id = $2 ORDER BY position, id",
    [ctx.organizationId, menuId],
  );
  const items = await tx.query<DraftItem & { sectionId: string }>(
    `SELECT i.id, i.section_id AS "sectionId", i.product_id AS "productId", p.name, p.description,
            p.price_cents AS "basePriceCents", i.price_override_cents AS "priceOverrideCents",
            COALESCE(i.price_override_cents, p.price_cents) AS "priceCents",
            p.allergens, p.active AS "productActive", p.image_media_id AS "imageMediaId", i.recommended
       FROM menu_items i
       JOIN menu_sections s ON s.organization_id = i.organization_id AND s.id = i.section_id
       JOIN menu_products p ON p.organization_id = i.organization_id AND p.id = i.product_id
      WHERE i.organization_id = $1 AND s.menu_id = $2
      ORDER BY i.position, i.id`,
    [ctx.organizationId, menuId],
  );
  const bySection = new Map<string, DraftItem[]>();
  for (const { sectionId, ...item } of items.rows) {
    (bySection.get(sectionId) ?? bySection.set(sectionId, []).get(sectionId)!).push(item);
  }
  const m = meta.rows[0]!;
  return {
    menu,
    establishmentName: m.establishment_name,
    establishmentSlug: m.establishment_slug,
    organizationSlug: m.organization_slug,
    sections: sections.rows.map((s) => ({ ...s, items: bySection.get(s.id) ?? [] })),
  };
}

async function requireSection(tx: Tx, ctx: TenantContext, menuId: string, sectionId: string): Promise<void> {
  if (!isUuid(sectionId)) throw new NotFoundError();
  const { rowCount } = await tx.query(
    "SELECT 1 FROM menu_sections WHERE organization_id = $1 AND menu_id = $2 AND id = $3",
    [ctx.organizationId, menuId, sectionId],
  );
  if (rowCount !== 1) throw new NotFoundError();
}

async function requireItem(tx: Tx, ctx: TenantContext, menuId: string, itemId: string): Promise<string> {
  if (!isUuid(itemId)) throw new NotFoundError();
  const { rows } = await tx.query<{ section_id: string }>(
    `SELECT i.section_id FROM menu_items i
       JOIN menu_sections s ON s.organization_id = i.organization_id AND s.id = i.section_id
      WHERE i.organization_id = $1 AND s.menu_id = $2 AND i.id = $3`,
    [ctx.organizationId, menuId, itemId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0].section_id;
}

async function audit(tx: Tx, ctx: TenantContext, menuId: string, action: string): Promise<void> {
  await recordAudit(tx, ctx, { action, entityType: "menu", entityId: menuId });
}

export async function addSection(tx: Tx, ctx: TenantContext, menuId: string, input: unknown): Promise<string> {
  requirePermission(ctx, "menus.edit");
  const { name } = parseInput(sectionNameSchema, input);
  await lockMenu(tx, ctx, menuId);
  const { rows } = await tx.query<{ n: number; next: number }>(
    `SELECT count(*)::int AS n, COALESCE(max(position), 0) + 1 AS next
       FROM menu_sections WHERE organization_id = $1 AND menu_id = $2`,
    [ctx.organizationId, menuId],
  );
  if (rows[0]!.n >= MAX_SECTIONS) throw new ValidationError(`Máximo ${MAX_SECTIONS} categorías por carta`);
  const res = await tx.query<{ id: string }>(
    "INSERT INTO menu_sections (organization_id, menu_id, name, position) VALUES ($1, $2, $3, $4) RETURNING id",
    [ctx.organizationId, menuId, name, rows[0]!.next],
  );
  await audit(tx, ctx, menuId, "menu.section_added");
  return res.rows[0]!.id;
}

export async function renameSection(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  sectionId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const { name } = parseInput(sectionNameSchema, input);
  await lockMenu(tx, ctx, menuId);
  await requireSection(tx, ctx, menuId, sectionId);
  await tx.query("UPDATE menu_sections SET name = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    sectionId,
    name,
  ]);
  await audit(tx, ctx, menuId, "menu.section_renamed");
}

export async function deleteSection(tx: Tx, ctx: TenantContext, menuId: string, sectionId: string): Promise<void> {
  requirePermission(ctx, "menus.edit");
  await lockMenu(tx, ctx, menuId);
  await requireSection(tx, ctx, menuId, sectionId);
  await tx.query("DELETE FROM menu_sections WHERE organization_id = $1 AND id = $2", [ctx.organizationId, sectionId]);
  await audit(tx, ctx, menuId, "menu.section_deleted");
}

/** Reescribe posiciones 1..n intercambiando el elemento con su vecino. */
async function swapPositions(
  tx: Tx,
  table: "menu_sections" | "menu_items",
  orgId: string,
  orderedIds: string[],
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const i = orderedIds.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= orderedIds.length) return;
  [orderedIds[i], orderedIds[j]] = [orderedIds[j]!, orderedIds[i]!];
  for (const [index, rowId] of orderedIds.entries()) {
    await tx.query(`UPDATE ${table} SET position = $3 WHERE organization_id = $1 AND id = $2`, [orgId, rowId, index + 1]);
  }
}

export async function moveSection(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  sectionId: string,
  direction: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const dir = parseInput(directionSchema, direction);
  await lockMenu(tx, ctx, menuId);
  await requireSection(tx, ctx, menuId, sectionId);
  const { rows } = await tx.query<{ id: string }>(
    "SELECT id FROM menu_sections WHERE organization_id = $1 AND menu_id = $2 ORDER BY position, id",
    [ctx.organizationId, menuId],
  );
  await swapPositions(tx, "menu_sections", ctx.organizationId, rows.map((r) => r.id), sectionId, dir);
  await audit(tx, ctx, menuId, "menu.section_moved");
}

export async function addItem(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  sectionId: string,
  input: unknown,
): Promise<string> {
  requirePermission(ctx, "menus.edit");
  const data = parseInput(addItemSchema, input);
  await lockMenu(tx, ctx, menuId);
  await requireSection(tx, ctx, menuId, sectionId);
  const product = await tx.query<{ active: boolean }>(
    "SELECT active FROM menu_products WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, data.productId],
  );
  if (!product.rows[0]) throw new NotFoundError("Producto no encontrado");
  if (!product.rows[0].active) throw new ValidationError("El producto está archivado");
  const { rows } = await tx.query<{ n: number; next: number }>(
    `SELECT count(*)::int AS n, COALESCE(max(position), 0) + 1 AS next
       FROM menu_items WHERE organization_id = $1 AND section_id = $2`,
    [ctx.organizationId, sectionId],
  );
  if (rows[0]!.n >= MAX_ITEMS_PER_SECTION) throw new ValidationError(`Máximo ${MAX_ITEMS_PER_SECTION} productos por categoría`);
  let id: string;
  try {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO menu_items (organization_id, section_id, product_id, position, price_override_cents)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ctx.organizationId, sectionId, data.productId, rows[0]!.next, data.priceOverrideCents ?? null],
    );
    id = res.rows[0]!.id;
  } catch (err) {
    mapUnique(err);
  }
  await audit(tx, ctx, menuId, "menu.item_added");
  return id;
}

export async function setItemPrice(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  itemId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const { priceOverrideCents } = parseInput(itemPriceSchema, input);
  await lockMenu(tx, ctx, menuId);
  await requireItem(tx, ctx, menuId, itemId);
  await tx.query("UPDATE menu_items SET price_override_cents = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    itemId,
    priceOverrideCents,
  ]);
  await audit(tx, ctx, menuId, "menu.item_price_set");
}

/** Marca un elemento como «recomendado» (se destaca en la página pública). */
export async function setItemRecommended(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  itemId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const { recommended } = parseInput(recommendedSchema, input);
  await lockMenu(tx, ctx, menuId);
  await requireItem(tx, ctx, menuId, itemId);
  await tx.query("UPDATE menu_items SET recommended = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    itemId,
    recommended,
  ]);
  await audit(tx, ctx, menuId, "menu.item_recommended_set");
}

export async function moveItem(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  itemId: string,
  direction: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const dir = parseInput(directionSchema, direction);
  await lockMenu(tx, ctx, menuId);
  const sectionId = await requireItem(tx, ctx, menuId, itemId);
  const { rows } = await tx.query<{ id: string }>(
    "SELECT id FROM menu_items WHERE organization_id = $1 AND section_id = $2 ORDER BY position, id",
    [ctx.organizationId, sectionId],
  );
  await swapPositions(tx, "menu_items", ctx.organizationId, rows.map((r) => r.id), itemId, dir);
  await audit(tx, ctx, menuId, "menu.item_moved");
}

export async function removeItem(tx: Tx, ctx: TenantContext, menuId: string, itemId: string): Promise<void> {
  requirePermission(ctx, "menus.edit");
  await lockMenu(tx, ctx, menuId);
  await requireItem(tx, ctx, menuId, itemId);
  await tx.query("DELETE FROM menu_items WHERE organization_id = $1 AND id = $2", [ctx.organizationId, itemId]);
  await audit(tx, ctx, menuId, "menu.item_removed");
}

// ---------------------------------------------------------------------------
// Instantánea, publicación y versiones
// ---------------------------------------------------------------------------

/** Construye la instantánea del borrador actual (también se usa para la vista previa). */
export async function buildSnapshot(tx: Tx, ctx: TenantContext, menuId: string): Promise<MenuSnapshot> {
  const draft = await getMenuDraft(tx, ctx, menuId);
  const org = await tx.query<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [ctx.organizationId]);
  return {
    schemaVersion: 1,
    theme: draft.menu.theme,
    organizationName: org.rows[0]!.name,
    establishmentName: draft.establishmentName,
    menuName: draft.menu.name,
    currency: "EUR",
    sections: draft.sections.map((s) => ({
      name: s.name,
      items: s.items.map((i) => ({
        name: i.name,
        description: i.description,
        priceCents: i.priceCents,
        allergens: i.allergens,
        ...(i.imageMediaId ? { imageId: i.imageMediaId } : {}),
        ...(i.recommended ? { recommended: true } : {}),
      })),
    })),
  };
}

/** Problemas que impiden publicar el borrador (lista vacía si se puede publicar). */
export function publicationProblems(draft: MenuDraft): string[] {
  const problems: string[] = [];
  if (draft.sections.length === 0) problems.push("La carta no tiene categorías");
  for (const s of draft.sections) {
    if (s.items.length === 0) problems.push(`La categoría «${s.name}» está vacía`);
    for (const i of s.items) if (!i.productActive) problems.push(`«${i.name}» está archivado`);
  }
  return problems;
}

/**
 * Publica el borrador como una nueva versión inmutable y la activa en la misma
 * transacción. Con la carta bloqueada, el número de versión es consecutivo y
 * dos publicaciones simultáneas generan versiones distintas.
 */
export async function publishMenu(tx: Tx, ctx: TenantContext, menuId: string): Promise<{ versionNumber: number }> {
  requirePermission(ctx, "menus.publish");
  await lockMenu(tx, ctx, menuId);
  const draft = await getMenuDraft(tx, ctx, menuId);
  const problems = publicationProblems(draft);
  if (problems.length) throw new ValidationError("No se puede publicar la carta", { publicacion: problems });

  const snapshot = await buildSnapshot(tx, ctx, menuId);
  const { rows } = await tx.query<{ id: string; version_number: number }>(
    `INSERT INTO menu_versions (organization_id, menu_id, version_number, snapshot, published_by_user_id)
     SELECT $1, $2, COALESCE(max(version_number), 0) + 1, $3, $4
       FROM menu_versions WHERE organization_id = $1 AND menu_id = $2
     RETURNING id, version_number`,
    [ctx.organizationId, menuId, JSON.stringify(snapshot), ctx.userId],
  );
  const version = rows[0]!;
  await tx.query("UPDATE menus SET published_version_id = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
    version.id,
  ]);
  await recordAudit(tx, ctx, {
    action: "menu.published",
    entityType: "menu",
    entityId: menuId,
    metadata: { version: version.version_number },
  });
  return { versionNumber: version.version_number };
}

export async function unpublishMenu(tx: Tx, ctx: TenantContext, menuId: string): Promise<void> {
  requirePermission(ctx, "menus.publish");
  await lockMenu(tx, ctx, menuId);
  await tx.query("UPDATE menus SET published_version_id = NULL WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
  ]);
  await audit(tx, ctx, menuId, "menu.unpublished");
}

/** Vuelve a activar una versión anterior (sin modificarla). */
export async function activateVersion(tx: Tx, ctx: TenantContext, menuId: string, versionId: string): Promise<void> {
  requirePermission(ctx, "menus.publish");
  if (!isUuid(versionId)) throw new NotFoundError();
  await lockMenu(tx, ctx, menuId);
  const { rows } = await tx.query<{ version_number: number }>(
    "SELECT version_number FROM menu_versions WHERE organization_id = $1 AND menu_id = $2 AND id = $3",
    [ctx.organizationId, menuId, versionId],
  );
  if (!rows[0]) throw new NotFoundError();
  await tx.query("UPDATE menus SET published_version_id = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
    versionId,
  ]);
  await recordAudit(tx, ctx, {
    action: "menu.version_activated",
    entityType: "menu",
    entityId: menuId,
    metadata: { version: rows[0].version_number },
  });
}

export async function listVersions(tx: Tx, ctx: TenantContext, menuId: string): Promise<MenuVersionSummary[]> {
  requirePermission(ctx, "menus.read");
  if (!isUuid(menuId)) throw new NotFoundError();
  const { rows } = await tx.query<MenuVersionSummary>(
    `SELECT v.id, v.version_number AS "versionNumber", v.published_at AS "publishedAt",
            u.display_name AS "publishedByName", (m.published_version_id = v.id) IS TRUE AS "isCurrent"
       FROM menu_versions v
       JOIN menus m ON m.organization_id = v.organization_id AND m.id = v.menu_id
       LEFT JOIN users u ON u.id = v.published_by_user_id
      WHERE v.organization_id = $1 AND v.menu_id = $2
      ORDER BY v.version_number DESC`,
    [ctx.organizationId, menuId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Lectura pública (sin sesión)
// ---------------------------------------------------------------------------

export interface PublishedMenu {
  versionNumber: number;
  publishedAt: Date;
  snapshot: MenuSnapshot;
}

const publicSlug = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/**
 * Carta publicada por sus identificadores públicos. Solo puede devolver la
 * versión publicada: la consulta pasa por app.published_menu(), que no tiene
 * acceso a borradores. Devuelve null si no existe o no está publicada.
 */
export async function getPublishedMenu(
  orgSlug: string,
  establishmentSlug: string,
  menuSlug: string,
): Promise<PublishedMenu | null> {
  const slugs = [orgSlug, establishmentSlug, menuSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => publicSlug.test(s))) return null;
  const { rows } = await getPool().query<{
    version_number: number;
    published_at: Date;
    snapshot: MenuSnapshot;
  }>("SELECT * FROM app.published_menu($1, $2, $3)", slugs);
  const r = rows[0];
  return r ? { versionNumber: r.version_number, publishedAt: r.published_at, snapshot: r.snapshot } : null;
}

/**
 * Ruta pública vigente de la carta con ese código, o null si no existe o no
 * está publicada. Permite que un QR impreso sobreviva a cambios de slug.
 */
export async function resolveMenuCode(code: string): Promise<string | null> {
  if (!/^[0-9a-f]{12}$/.test(code)) return null;
  const { rows } = await getPool().query<{ organization_slug: string; establishment_slug: string; menu_slug: string }>(
    "SELECT * FROM app.resolve_menu_code($1)",
    [code],
  );
  const r = rows[0];
  return r ? `/m/${r.organization_slug}/${r.establishment_slug}/${r.menu_slug}` : null;
}
