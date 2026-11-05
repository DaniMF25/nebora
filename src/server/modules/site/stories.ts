import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { getPool, type Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { storeImage } from "@/server/modules/media/service";
import { isValidLocalDate } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { planAllowsCustomLook, publicEstablishmentPlan } from "./plan-look";

/**
 * Historias de la web del local (migración 0036, D-059): avisos destacados
 * (evento, apertura, cambio de horario…) con foto opcional, botón opcional y
 * fechas. Se gestionan con «editar local» y, como la galería, son del plan
 * Avanzado («site.customize»). La BD solo publica las vigentes de una web
 * publicada (app.public_site_stories) y sirve su foto mientras lo están.
 */

export const MAX_STORIES = 10;
export const STORY_TITLE_MAX = 60;
export const STORY_BODY_MAX = 280;
export const STORY_CTA_KINDS = ["none", "booking", "menu", "contact", "url"] as const;
export type StoryCtaKind = (typeof STORY_CTA_KINDS)[number];

export interface Story {
  id: string;
  title: string;
  body: string | null;
  mediaId: string | null;
  ctaKind: StoryCtaKind;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface PublicStory {
  id: string;
  title: string;
  body: string | null;
  mediaId: string | null;
  ctaKind: StoryCtaKind;
  ctaLabel: string | null;
  ctaUrl: string | null;
  /** Cambia al editarla: así una historia modificada vuelve a contar como no vista. */
  version: string;
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} admite ${max} caracteres`)
    .transform((v) => (v === "" ? null : v));
const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidLocalDate(v), { message: "Fecha no válida" })
  .transform((v) => (v === "" ? null : v));

export const storySchema = z
  .object({
    title: z.string().trim().min(1, "Escribe un titular").max(STORY_TITLE_MAX, `El titular admite ${STORY_TITLE_MAX} caracteres`),
    body: optionalText(STORY_BODY_MAX, "El texto"),
    ctaKind: z.enum(STORY_CTA_KINDS),
    ctaLabel: optionalText(30, "El texto del botón"),
    ctaUrl: optionalText(500, "El enlace"),
    startsOn: optionalDate,
    endsOn: optionalDate,
  })
  .strict()
  .superRefine((s, issue) => {
    if (s.ctaKind === "url") {
      if (!s.ctaUrl || !/^https:\/\/\S+$/.test(s.ctaUrl) || !URL.canParse(s.ctaUrl)) {
        issue.addIssue({ code: "custom", path: ["ctaUrl"], message: "Escribe un enlace que empiece por https://" });
      }
      if (!s.ctaLabel) issue.addIssue({ code: "custom", path: ["ctaLabel"], message: "Escribe el texto del botón" });
    }
    if (s.startsOn && s.endsOn && s.endsOn < s.startsOn) {
      issue.addIssue({ code: "custom", path: ["endsOn"], message: "La fecha de fin es anterior a la de inicio" });
    }
  })
  // Solo el enlace propio lleva dirección y texto; los demás botones usan los de la web.
  .transform((s) => (s.ctaKind === "url" ? s : { ...s, ctaLabel: null, ctaUrl: null }));

const COLUMNS = `id, title, body, media_id AS "mediaId", cta_kind AS "ctaKind", cta_label AS "ctaLabel",
  cta_url AS "ctaUrl", to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn"`;

function requireEditor(ctx: TenantContext): void {
  requirePermission(ctx, "establishments.update");
  // Las historias son del plan Avanzado, como la galería (D-047, D-059).
  requirePermission(ctx, "site.customize");
}

export async function listStories(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<Story[]> {
  requirePermission(ctx, "establishments.read");
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { rows } = await tx.query<Story>(
    `SELECT ${COLUMNS} FROM site_stories WHERE organization_id = $1 AND establishment_id = $2 ORDER BY position, id`,
    [ctx.organizationId, est.id],
  );
  return rows;
}

/** Bloquea las historias del local (orden y número) frente a cambios simultáneos. */
async function lockStories(tx: Tx, establishmentId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('stories:' || $1::text, 0))", [establishmentId]);
}

async function requireStory(tx: Tx, ctx: TenantContext, establishmentId: string, storyId: string) {
  if (!isUuid(storyId)) throw new NotFoundError();
  const { rows } = await tx.query<{ position: number; mediaId: string | null }>(
    `SELECT position, media_id AS "mediaId" FROM site_stories
      WHERE organization_id = $1 AND establishment_id = $2 AND id = $3 FOR UPDATE`,
    [ctx.organizationId, establishmentId, storyId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** Crea una historia al final, con foto si se adjunta. */
export async function createStory(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
  image?: Uint8Array | null,
): Promise<string> {
  requireEditor(ctx);
  const d = parseInput(storySchema, input);
  const est = await getEstablishment(tx, ctx, establishmentId);
  await lockStories(tx, est.id);
  const { rows } = await tx.query<{ n: number; next: number }>(
    `SELECT count(*)::int AS n, COALESCE(max(position), 0) + 1 AS next
       FROM site_stories WHERE organization_id = $1 AND establishment_id = $2`,
    [ctx.organizationId, est.id],
  );
  if (rows[0]!.n >= MAX_STORIES) throw new ValidationError(`Puedes tener hasta ${MAX_STORIES} historias`);
  const media = image && image.length > 0 ? await storeImage(tx, ctx, image) : null;
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO site_stories (organization_id, establishment_id, title, body, media_id, cta_kind, cta_label, cta_url,
                               starts_on, ends_on, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      ctx.organizationId,
      est.id,
      d.title,
      d.body,
      media?.id ?? null,
      d.ctaKind,
      d.ctaLabel,
      d.ctaUrl,
      d.startsOn,
      d.endsOn,
      rows[0]!.next,
    ],
  );
  const id = inserted.rows[0]!.id;
  await recordAudit(tx, ctx, { action: "site.story_created", entityType: "site_story", entityId: id });
  return id;
}

/** Modifica textos, botón y fechas; con una foto nueva, sustituye la anterior (y la borra). */
export async function updateStory(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  storyId: string,
  input: unknown,
  image?: Uint8Array | null,
): Promise<void> {
  requireEditor(ctx);
  const d = parseInput(storySchema, input);
  const est = await getEstablishment(tx, ctx, establishmentId);
  const current = await requireStory(tx, ctx, est.id, storyId);
  let mediaId = current.mediaId;
  if (image && image.length > 0) mediaId = (await storeImage(tx, ctx, image)).id;
  await tx.query(
    `UPDATE site_stories SET title = $3, body = $4, cta_kind = $5, cta_label = $6, cta_url = $7,
                             starts_on = $8, ends_on = $9, media_id = $10
      WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, storyId, d.title, d.body, d.ctaKind, d.ctaLabel, d.ctaUrl, d.startsOn, d.endsOn, mediaId],
  );
  if (current.mediaId && current.mediaId !== mediaId) await deleteMedia(tx, ctx, current.mediaId);
  await recordAudit(tx, ctx, { action: "site.story_updated", entityType: "site_story", entityId: storyId });
}

/** Quita la foto de la historia (queda sobre el color del estilo) y borra el archivo. */
export async function removeStoryImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  storyId: string,
): Promise<void> {
  requireEditor(ctx);
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { mediaId } = await requireStory(tx, ctx, est.id, storyId);
  if (mediaId) await deleteMedia(tx, ctx, mediaId); // ON DELETE SET NULL deja la historia sin foto
}

/** Intercambia la historia con la anterior o la siguiente. La primera es la que se abre sola. */
export async function moveStory(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  storyId: string,
  direction: unknown,
): Promise<void> {
  requireEditor(ctx);
  const dir = parseInput(z.enum(["up", "down"]), direction);
  const est = await getEstablishment(tx, ctx, establishmentId);
  await lockStories(tx, est.id);
  const current = await requireStory(tx, ctx, est.id, storyId);
  const { rows } = await tx.query<{ id: string; position: number }>(
    `SELECT id, position FROM site_stories
      WHERE organization_id = $1 AND establishment_id = $2
        AND (CASE WHEN $3 = 'up' THEN position < $4 ELSE position > $4 END)
      ORDER BY CASE WHEN $3 = 'up' THEN -position ELSE position END
      LIMIT 1`,
    [ctx.organizationId, est.id, dir, current.position],
  );
  const other = rows[0];
  if (!other) return;
  await tx.query(
    `UPDATE site_stories SET position = CASE id WHEN $2 THEN $3::int ELSE $4::int END
      WHERE organization_id = $1 AND id IN ($2, $5)`,
    [ctx.organizationId, storyId, other.position, current.position, other.id],
  );
}

export async function deleteStory(tx: Tx, ctx: TenantContext, establishmentId: string, storyId: string): Promise<void> {
  requireEditor(ctx);
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { mediaId } = await requireStory(tx, ctx, est.id, storyId);
  await tx.query("DELETE FROM site_stories WHERE organization_id = $1 AND id = $2", [ctx.organizationId, storyId]);
  if (mediaId) await deleteMedia(tx, ctx, mediaId);
  await recordAudit(tx, ctx, { action: "site.story_deleted", entityType: "site_story", entityId: storyId });
}

async function deleteMedia(tx: Tx, ctx: TenantContext, mediaId: string): Promise<void> {
  await tx.query("DELETE FROM media_assets WHERE organization_id = $1 AND id = $2", [ctx.organizationId, mediaId]);
}

/** Historias vigentes de una web publicada (vacío en Básico o si no hay). Sin sesión. */
export async function getPublicStories(establishmentId: string): Promise<PublicStory[]> {
  if (!isUuid(establishmentId)) return [];
  if (!planAllowsCustomLook(await publicEstablishmentPlan(establishmentId))) return [];
  const { rows } = await getPool().query<{
    id: string;
    title: string;
    body: string | null;
    media_id: string | null;
    cta_kind: StoryCtaKind;
    cta_label: string | null;
    cta_url: string | null;
    updated_at: Date;
  }>("SELECT * FROM app.public_site_stories($1)", [establishmentId]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    mediaId: r.media_id,
    ctaKind: r.cta_kind,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    version: `${r.id}:${r.updated_at.getTime()}`,
  }));
}
