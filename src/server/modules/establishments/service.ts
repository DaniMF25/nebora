import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError } from "@/server/errors";
import { nameSchema, slugSchema, timezoneSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export interface Establishment {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const createEstablishmentSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    timezone: timezoneSchema.default("Europe/Madrid"),
    address: addressSchema.optional(),
  })
  .strict();

export const updateEstablishmentSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    timezone: timezoneSchema.optional(),
    address: addressSchema.optional(),
  })
  .strict();

const SELECT_COLUMNS = `id, organization_id AS "organizationId", name, slug::text AS slug, timezone,
  address, created_at AS "createdAt", updated_at AS "updatedAt"`;

// Todas las consultas filtran explícitamente por la organización del contexto
// (validada en servidor) además de la protección RLS.

export async function listEstablishments(tx: Tx, ctx: TenantContext): Promise<Establishment[]> {
  requirePermission(ctx, "establishments.read");
  const { rows } = await tx.query<Establishment>(
    `SELECT ${SELECT_COLUMNS} FROM establishments WHERE organization_id = $1 ORDER BY name`,
    [ctx.organizationId],
  );
  return rows;
}

export async function getEstablishment(tx: Tx, ctx: TenantContext, id: string): Promise<Establishment> {
  requirePermission(ctx, "establishments.read");
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<Establishment>(
    `SELECT ${SELECT_COLUMNS} FROM establishments WHERE organization_id = $1 AND id = $2`,
    [ctx.organizationId, id],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function createEstablishment(tx: Tx, ctx: TenantContext, input: unknown): Promise<Establishment> {
  requirePermission(ctx, "establishments.create");
  const data = parseInput(createEstablishmentSchema, input);
  try {
    const { rows } = await tx.query<Establishment>(
      `INSERT INTO establishments (organization_id, name, slug, timezone, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${SELECT_COLUMNS}`,
      [ctx.organizationId, data.name, data.slug, data.timezone, data.address ?? null],
    );
    const est = rows[0]!;
    await recordAudit(tx, ctx, {
      action: "establishment.created",
      entityType: "establishment",
      entityId: est.id,
      metadata: { slug: est.slug },
    });
    return est;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Ya existe un establecimiento con ese identificador");
    throw err;
  }
}

export async function updateEstablishment(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<Establishment> {
  requirePermission(ctx, "establishments.update");
  if (!isUuid(id)) throw new NotFoundError();
  const data = parseInput(updateEstablishmentSchema, input);
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (fields.length === 0) return getEstablishment(tx, ctx, id);

  try {
    // Columnas tomadas de una lista blanca (claves del esquema estricto); los valores van parametrizados.
    const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
    const { rows } = await tx.query<Establishment>(
      `UPDATE establishments SET ${sets}
        WHERE organization_id = $1 AND id = $2 RETURNING ${SELECT_COLUMNS}`,
      [ctx.organizationId, id, ...fields.map((f) => data[f] ?? null)],
    );
    if (!rows[0]) throw new NotFoundError();
    await recordAudit(tx, ctx, {
      action: "establishment.updated",
      entityType: "establishment",
      entityId: id,
      metadata: { fields },
    });
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Ya existe un establecimiento con ese identificador");
    throw err;
  }
}
