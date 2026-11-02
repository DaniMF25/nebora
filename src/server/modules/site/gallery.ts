import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { getPool, type Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { storeImage } from "@/server/modules/media/service";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { planAllowsCustomLook, publicEstablishmentPlan } from "./plan-look";

/**
 * Galería de la web del local (D-039): fotos con pie opcional y orden. Cada
 * foto es un archivo propio que se borra al quitarla.
 */

export const MAX_GALLERY_IMAGES = 24;
export const MAX_CAPTION_LENGTH = 120;

export interface GalleryImage {
  id: string;
  mediaId: string;
  caption: string | null;
}

const captionSchema = z
  .string()
  .trim()
  .max(MAX_CAPTION_LENGTH, `El pie de foto admite ${MAX_CAPTION_LENGTH} caracteres`)
  .transform((v) => (v === "" ? null : v));

export async function listGallery(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<GalleryImage[]> {
  requirePermission(ctx, "establishments.read");
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { rows } = await tx.query<GalleryImage>(
    `SELECT id, media_id AS "mediaId", caption FROM site_gallery_images
      WHERE organization_id = $1 AND establishment_id = $2 ORDER BY position, id`,
    [ctx.organizationId, est.id],
  );
  return rows;
}

/** Bloquea la galería del local (orden y número) frente a cambios simultáneos. */
async function lockGallery(tx: Tx, establishmentId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('gallery:' || $1::text, 0))", [establishmentId]);
}

export async function addGalleryImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  bytes: Uint8Array,
  input: unknown,
): Promise<string> {
  requirePermission(ctx, "establishments.update");
  // La galería es del plan Avanzado (D-047).
  requirePermission(ctx, "site.customize");
  const { caption } = parseInput(z.object({ caption: captionSchema.optional() }).strict(), input);
  const est = await getEstablishment(tx, ctx, establishmentId);
  await lockGallery(tx, est.id);
  const { rows } = await tx.query<{ n: number; next: number }>(
    `SELECT count(*)::int AS n, COALESCE(max(position), 0) + 1 AS next
       FROM site_gallery_images WHERE organization_id = $1 AND establishment_id = $2`,
    [ctx.organizationId, est.id],
  );
  if (rows[0]!.n >= MAX_GALLERY_IMAGES) throw new ValidationError(`La galería admite ${MAX_GALLERY_IMAGES} fotos`);
  const image = await storeImage(tx, ctx, bytes);
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO site_gallery_images (organization_id, establishment_id, media_id, caption, position)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ctx.organizationId, est.id, image.id, caption ?? null, rows[0]!.next],
  );
  await recordAudit(tx, ctx, { action: "site.gallery_image_added", entityType: "establishment", entityId: est.id });
  return inserted.rows[0]!.id;
}

/** Comprueba que la foto es de la galería de ese local y devuelve su posición y archivo. */
async function requireImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  imageId: string,
): Promise<{ position: number; mediaId: string }> {
  if (!isUuid(imageId)) throw new NotFoundError();
  const { rows } = await tx.query<{ position: number; mediaId: string }>(
    `SELECT position, media_id AS "mediaId" FROM site_gallery_images
      WHERE organization_id = $1 AND establishment_id = $2 AND id = $3`,
    [ctx.organizationId, establishmentId, imageId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function setGalleryCaption(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  imageId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  // La galería es del plan Avanzado (D-047).
  requirePermission(ctx, "site.customize");
  const { caption } = parseInput(z.object({ caption: captionSchema }).strict(), input);
  const est = await getEstablishment(tx, ctx, establishmentId);
  await requireImage(tx, ctx, est.id, imageId);
  await tx.query("UPDATE site_gallery_images SET caption = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    imageId,
    caption,
  ]);
}

/** Intercambia la foto con la anterior o la siguiente. */
export async function moveGalleryImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  imageId: string,
  direction: unknown,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  // La galería es del plan Avanzado (D-047).
  requirePermission(ctx, "site.customize");
  const dir = parseInput(z.enum(["up", "down"]), direction);
  const est = await getEstablishment(tx, ctx, establishmentId);
  await lockGallery(tx, est.id);
  const current = await requireImage(tx, ctx, est.id, imageId);
  const { rows } = await tx.query<{ id: string; position: number }>(
    `SELECT id, position FROM site_gallery_images
      WHERE organization_id = $1 AND establishment_id = $2
        AND (CASE WHEN $3 = 'up' THEN position < $4 ELSE position > $4 END)
      ORDER BY CASE WHEN $3 = 'up' THEN -position ELSE position END
      LIMIT 1`,
    [ctx.organizationId, est.id, dir, current.position],
  );
  const other = rows[0];
  if (!other) return;
  await tx.query(
    `UPDATE site_gallery_images SET position = CASE id WHEN $2 THEN $3::int ELSE $4::int END
      WHERE organization_id = $1 AND id IN ($2, $5)`,
    [ctx.organizationId, imageId, other.position, current.position, other.id],
  );
}

/** Quita la foto y borra su archivo (libera cupo de imágenes). */
export async function removeGalleryImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  imageId: string,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  // La galería es del plan Avanzado (D-047).
  requirePermission(ctx, "site.customize");
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { mediaId } = await requireImage(tx, ctx, est.id, imageId);
  // El archivo es solo de esta foto; borrarlo elimina también la fila (ON DELETE CASCADE).
  await tx.query("DELETE FROM media_assets WHERE organization_id = $1 AND id = $2", [ctx.organizationId, mediaId]);
  await recordAudit(tx, ctx, { action: "site.gallery_image_removed", entityType: "establishment", entityId: est.id });
}

/** Galería pública de un local con la web publicada (vacía si no lo está). */
export async function getPublicGallery(
  establishmentId: string,
): Promise<{ mediaId: string; caption: string | null }[]> {
  if (!isUuid(establishmentId)) return [];
  // En Básico no hay galería (D-047); las fotos guardadas vuelven al subir de plan.
  if (!planAllowsCustomLook(await publicEstablishmentPlan(establishmentId))) return [];
  const { rows } = await getPool().query<{ media_id: string; caption: string | null }>(
    "SELECT * FROM app.public_site_gallery($1)",
    [establishmentId],
  );
  return rows.map((r) => ({ mediaId: r.media_id, caption: r.caption }));
}
