import "server-only";
import { z } from "zod";
import type { Allergen } from "@/lib/allergens";
import type { Language, PublicLanguage } from "@/lib/languages";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { recordAudit } from "@/server/audit/audit";
import { getPool, isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { entryFor, text, type StoredI18n } from "@/server/modules/translations/stored";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { isValidLocalDate, localDateOf } from "../schedules/time";
import { priceCentsSchema } from "./products";

/**
 * Fuera de carta (D-037): platos del catálogo que un local ofrece aparte, con
 * precio especial y vigencia opcionales. No pasan por las versiones de las
 * cartas: se ven al momento en las páginas públicas del local.
 */

export const MAX_SPECIALS = 30;

export type SpecialStatus = "visible" | "scheduled" | "expired" | "archived" | "unavailable";

export interface Special {
  id: string;
  productId: string;
  productName: string;
  /** Precio que se muestra: el especial o el del catálogo. */
  priceCents: number;
  priceOverrideCents: number | null;
  startsOn: string | null;
  endsOn: string | null;
  status: SpecialStatus;
}

const dateSchema = z.string().refine(isValidLocalDate, "Fecha no válida").nullable().optional();

const addSpecialSchema = z
  .object({
    productId: z.string().uuid(),
    priceOverrideCents: priceCentsSchema.nullable().optional(),
    startsOn: dateSchema,
    endsOn: dateSchema,
  })
  .strict();

/** Estado de un plato fuera de carta en la fecha local `today`. */
export function specialStatus(
  s: { startsOn: string | null; endsOn: string | null; active: boolean; available: boolean },
  today: string,
): SpecialStatus {
  if (!s.active) return "archived";
  if (!s.available) return "unavailable";
  if (s.endsOn && s.endsOn < today) return "expired";
  if (s.startsOn && s.startsOn > today) return "scheduled";
  return "visible";
}

export async function listSpecials(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<Special[]> {
  requirePermission(ctx, "menus.read");
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { rows } = await tx.query<{
    id: string;
    productId: string;
    productName: string;
    catalogPrice: number;
    priceOverrideCents: number | null;
    startsOn: string | null;
    endsOn: string | null;
    active: boolean;
    available: boolean;
  }>(
    `SELECT s.id, s.product_id AS "productId", p.name AS "productName", p.price_cents AS "catalogPrice",
            s.price_override_cents AS "priceOverrideCents", s.starts_on::text AS "startsOn", s.ends_on::text AS "endsOn",
            p.active, app.product_available_in(s.organization_id, s.product_id, s.establishment_id) AS available
       FROM menu_specials s
       JOIN menu_products p ON p.organization_id = s.organization_id AND p.id = s.product_id
      WHERE s.organization_id = $1 AND s.establishment_id = $2
      ORDER BY s.created_at, s.id`,
    [ctx.organizationId, est.id],
  );
  const today = localDateOf(new Date(), est.timezone);
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    priceCents: r.priceOverrideCents ?? r.catalogPrice,
    priceOverrideCents: r.priceOverrideCents,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: specialStatus(r, today),
  }));
}

export async function addSpecial(tx: Tx, ctx: TenantContext, establishmentId: string, input: unknown): Promise<string> {
  requirePermission(ctx, "menus.edit");
  const data = parseInput(addSpecialSchema, input);
  if (data.startsOn && data.endsOn && data.endsOn < data.startsOn) {
    throw new ValidationError("La fecha «hasta» no puede ser anterior a «desde»");
  }
  const est = await getEstablishment(tx, ctx, establishmentId);
  // Bloquea el local para contar sin carreras.
  await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2 FOR UPDATE", [
    ctx.organizationId,
    est.id,
  ]);
  const product = await tx.query<{ active: boolean; available: boolean }>(
    `SELECT active, app.product_available_in(organization_id, id, $3) AS available
       FROM menu_products WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, data.productId, est.id],
  );
  if (!product.rows[0]) throw new NotFoundError("Producto no encontrado");
  if (!product.rows[0].active) throw new ValidationError("El producto está archivado");
  // El trigger de menu_specials lo garantiza también en la base de datos.
  if (!product.rows[0].available) throw new ValidationError("Este producto no está disponible en este local");
  const count = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM menu_specials WHERE organization_id = $1 AND establishment_id = $2",
    [ctx.organizationId, est.id],
  );
  if (count.rows[0]!.n >= MAX_SPECIALS) throw new ValidationError(`Máximo ${MAX_SPECIALS} platos fuera de carta`);
  let id: string;
  try {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO menu_specials (organization_id, establishment_id, product_id, price_override_cents, starts_on, ends_on)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        ctx.organizationId,
        est.id,
        data.productId,
        data.priceOverrideCents ?? null,
        data.startsOn ?? null,
        data.endsOn ?? null,
      ],
    );
    id = res.rows[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err, "menu_specials_establishment_product_unique")) {
      throw new ConflictError("Ese plato ya está fuera de carta en este local");
    }
    throw err;
  }
  await recordAudit(tx, ctx, { action: "special.added", entityType: "establishment", entityId: est.id });
  return id;
}

export async function removeSpecial(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  specialId: string,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  if (!isUuid(specialId)) throw new NotFoundError();
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { rowCount } = await tx.query(
    "DELETE FROM menu_specials WHERE organization_id = $1 AND establishment_id = $2 AND id = $3",
    [ctx.organizationId, est.id, specialId],
  );
  if (rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "special.removed", entityType: "establishment", entityId: est.id });
}

// ---------------------------------------------------------------------------
// Lectura pública (sin sesión)
// ---------------------------------------------------------------------------

type SnapshotItem = MenuSnapshot["sections"][number]["items"][number];

const publicSlug = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/**
 * Platos fuera de carta que se ven hoy en el local, en `lang` (lo no traducido,
 * en español). Solo lee mediante app.public_specials.
 */
export async function getPublicSpecials(
  orgSlug: string,
  establishmentSlug: string,
  lang: PublicLanguage,
): Promise<SnapshotItem[]> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => publicSlug.test(s))) return [];
  const { rows } = await getPool().query<{
    product_name: string;
    description: string | null;
    price_cents: number;
    allergens: Allergen[];
    image_media_id: string | null;
    i18n: StoredI18n | null;
    languages: Language[];
  }>("SELECT * FROM app.public_specials($1, $2)", slugs);
  return rows.map((r) => {
    const entry = lang !== "es" && r.languages.includes(lang) ? entryFor(r.i18n, lang) : {};
    return {
      name: text(entry, "name") || r.product_name,
      description: text(entry, "description") || r.description,
      priceCents: r.price_cents,
      allergens: r.allergens,
      ...(r.image_media_id ? { imageId: r.image_media_id } : {}),
    };
  });
}

/** Carta con los platos fuera de carta como primera sección (ya traducida). */
export function withSpecials(snapshot: MenuSnapshot, specials: SnapshotItem[], title: string): MenuSnapshot {
  if (specials.length === 0) return snapshot;
  return { ...snapshot, sections: [{ name: title, items: specials }, ...snapshot.sections] };
}
