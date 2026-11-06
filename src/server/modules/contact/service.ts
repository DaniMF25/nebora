import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { getPool, isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { fingerprint, hitRateLimit } from "@/server/rate-limit";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { expireTrialsIfDue } from "@/server/modules/organizations/trial";

// Formulario de contacto de la web y bandeja «Mensajes» del panel (D-049).
// Sin proveedor de correo, los mensajes solo llegan al panel. Los textos de
// error están en español; la acción pública los traduce (contact-i18n).

export const CONTACT_RATE_LIMITS = { perClientPerHour: 5, perEstablishmentPerHour: 100, perContactPerDay: 3 };
export const MAX_MESSAGE_LENGTH = 2000;
/** Motivos del mensaje (D-052). */
export const CONTACT_TOPICS = ["group", "event", "allergies", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export interface ContactMessage {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  message: string | null;
  status: "new" | "read" | "archived";
  topic: ContactTopic | null;
  createdAt: Date;
  readAt: Date | null;
}

export const contactSchema = z
  .object({
    customerName: z.string().trim().min(1, "Indica tu nombre").max(120),
    customerPhone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+0-9 ()-]*$/, { message: "Teléfono no válido" }),
    customerEmail: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Correo no válido" }),
    message: z
      .string()
      .trim()
      .min(1, "Escribe tu mensaje")
      .max(MAX_MESSAGE_LENGTH, `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres`),
    consent: z.literal(true, { message: "Debes aceptar el tratamiento de datos para que podamos responderte" }),
    // Campo trampa: invisible para personas; los bots suelen rellenarlo.
    website: z.string().max(0, { message: "No se pudo procesar la solicitud" }),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    // Motivo opcional (D-052); "" = sin motivo.
    topic: z
      .union([z.enum(CONTACT_TOPICS), z.literal("")])
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict()
  .refine((v) => v.customerPhone !== "" || v.customerEmail !== "", {
    message: "Indica un teléfono o un correo para poder responderte",
    path: ["customerPhone"],
  });

/**
 * Alta desde la web pública. La BD exige web publicada y plan Avanzado o
 * superior; aquí se valida y se limitan los envíos por cliente, local y contacto.
 */
export async function submitContactMessage(
  establishmentId: string,
  input: unknown,
  clientId: string,
): Promise<{ replayed: boolean }> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const d = parseInput(contactSchema, input);
  await expireTrialsIfDue();
  const contact = (d.customerEmail || d.customerPhone).toLowerCase();
  for (const [bucket, seconds, max] of [
    [`ct:client:${fingerprint(clientId)}`, 3600, CONTACT_RATE_LIMITS.perClientPerHour],
    [`ct:est:${establishmentId}`, 3600, CONTACT_RATE_LIMITS.perEstablishmentPerHour],
    [`ct:contact:${establishmentId}:${fingerprint(contact)}`, 86_400, CONTACT_RATE_LIMITS.perContactPerDay],
  ] as const) {
    if (!(await hitRateLimit(bucket, seconds, max))) {
      throw new RateLimitedError("Demasiados mensajes. Inténtalo más tarde o llama al restaurante.");
    }
  }
  try {
    const { rows } = await getPool().query<{ replayed: boolean }>(
      "SELECT * FROM app.public_contact($1, $2, $3, $4, $5, $6, $7)",
      [
        establishmentId,
        d.customerName,
        d.customerEmail ? d.customerEmail.toLowerCase() : null,
        d.customerPhone || null,
        d.message,
        d.idempotencyKey,
        d.topic,
      ],
    );
    return { replayed: rows[0]!.replayed };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "P0001" && e.message === "contact_disabled") {
      throw new ValidationError("Este restaurante no recibe mensajes desde la web");
    }
    if (isUniqueViolation(err, "contact_messages_idempotency_unique")) {
      throw new ConflictError("Tu mensaje ya se está enviando. Revisa en unos segundos.");
    }
    throw err;
  }
}

const COLUMNS = `id, topic, customer_name AS "customerName", customer_email AS "customerEmail",
  customer_phone AS "customerPhone", message, status, created_at AS "createdAt", read_at AS "readAt"`;

async function establishmentExists(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

/** Bandeja de un local: los nuevos y leídos, o los archivados. */
export async function listMessages(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  options: { archived?: boolean } = {},
): Promise<ContactMessage[]> {
  requirePermission(ctx, "messages.read");
  await establishmentExists(tx, ctx, establishmentId);
  const { rows } = await tx.query<ContactMessage>(
    `SELECT ${COLUMNS} FROM contact_messages
      WHERE organization_id = $1 AND establishment_id = $2 AND anonymized_at IS NULL
        AND (status = 'archived') = $3
      ORDER BY created_at DESC, id
      LIMIT 200`,
    [ctx.organizationId, establishmentId, options.archived ?? false],
  );
  return rows;
}

/** Mensajes sin leer por local (para el inicio y el menú). */
export async function unreadMessageCounts(tx: Tx, ctx: TenantContext): Promise<Map<string, number>> {
  if (!ctx.permissions.has("messages.read")) return new Map();
  const { rows } = await tx.query<{ establishment_id: string; n: number }>(
    `SELECT establishment_id, count(*)::int AS n FROM contact_messages
      WHERE organization_id = $1 AND status = 'new' AND anonymized_at IS NULL
      GROUP BY establishment_id`,
    [ctx.organizationId],
  );
  return new Map(rows.map((r) => [r.establishment_id, r.n]));
}

async function getMessage(tx: Tx, ctx: TenantContext, establishmentId: string, id: string): Promise<ContactMessage> {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<ContactMessage>(
    `SELECT ${COLUMNS} FROM contact_messages
      WHERE organization_id = $1 AND establishment_id = $2 AND id = $3 AND anonymized_at IS NULL FOR UPDATE`,
    [ctx.organizationId, establishmentId, id],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

const STATUS_PERMISSION = { read: "messages.read", new: "messages.read", archived: "messages.manage" } as const;

/** Marca como leído / no leído (quien lee) o archiva (encargados). */
export async function setMessageStatus(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  id: string,
  input: unknown,
): Promise<void> {
  const { status } = parseInput(z.object({ status: z.enum(["new", "read", "archived"]) }).strict(), input);
  requirePermission(ctx, STATUS_PERMISSION[status]);
  await getMessage(tx, ctx, establishmentId, id);
  await tx.query(
    `UPDATE contact_messages SET status = $3, read_at = CASE WHEN $3 = 'new' THEN NULL ELSE coalesce(read_at, now()) END
      WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, id, status],
  );
  await recordAudit(tx, ctx, {
    action: "contact.status_set",
    entityType: "contact_message",
    entityId: id,
    metadata: { status },
  });
}

/** Borra un mensaje (encargados). */
export async function deleteMessage(tx: Tx, ctx: TenantContext, establishmentId: string, id: string): Promise<void> {
  requirePermission(ctx, "messages.manage");
  await getMessage(tx, ctx, establishmentId, id);
  await tx.query("DELETE FROM contact_messages WHERE organization_id = $1 AND id = $2", [ctx.organizationId, id]);
  await recordAudit(tx, ctx, { action: "contact.deleted", entityType: "contact_message", entityId: id });
}

/** Plazo de conservación de datos de clientes, para el consentimiento de la página pública (sin sesión). */
export async function publicRetentionDays(establishmentId: string): Promise<number> {
  if (!isUuid(establishmentId)) return 365;
  const { rows } = await getPool().query<{ days: number | null }>("SELECT app.public_retention_days($1) AS days", [
    establishmentId,
  ]);
  return rows[0]?.days ?? 365;
}
