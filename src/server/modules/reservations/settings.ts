import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { NotFoundError } from "@/server/errors";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export interface ReservationSettings {
  publicEnabled: boolean;
  minParty: number;
  maxParty: number;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
}

export const DEFAULT_SETTINGS: ReservationSettings = {
  publicEnabled: false,
  minParty: 1,
  maxParty: 8,
  durationMinutes: 90,
  slotIntervalMinutes: 15,
  minNoticeMinutes: 120,
  maxDaysAhead: 30,
  autoConfirm: true,
};

export const settingsSchema = z
  .object({
    publicEnabled: z.boolean(),
    minParty: z.number().int().min(1).max(50),
    maxParty: z.number().int().min(1).max(50),
    durationMinutes: z.number().int().min(30).max(300),
    slotIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    minNoticeMinutes: z.number().int().min(0).max(10080),
    maxDaysAhead: z.number().int().min(1).max(365),
    autoConfirm: z.boolean(),
  })
  .strict()
  .refine((s) => s.maxParty >= s.minParty, { message: "El máximo de comensales no puede ser menor que el mínimo" });

const COLUMNS = `public_enabled AS "publicEnabled", min_party AS "minParty", max_party AS "maxParty",
  duration_minutes AS "durationMinutes", slot_interval_minutes AS "slotIntervalMinutes",
  min_notice_minutes AS "minNoticeMinutes", max_days_ahead AS "maxDaysAhead", auto_confirm AS "autoConfirm"`;

async function establishmentExists(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

export async function getReservationSettings(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<ReservationSettings> {
  requirePermission(ctx, "reservations.read");
  await establishmentExists(tx, ctx, establishmentId);
  const { rows } = await tx.query<ReservationSettings>(
    `SELECT ${COLUMNS} FROM reservation_settings WHERE organization_id = $1 AND establishment_id = $2`,
    [ctx.organizationId, establishmentId],
  );
  return rows[0] ?? DEFAULT_SETTINGS;
}

export async function updateReservationSettings(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<ReservationSettings> {
  requirePermission(ctx, "establishments.update");
  const d = parseInput(settingsSchema, input);
  await establishmentExists(tx, ctx, establishmentId);
  const values = [
    d.publicEnabled,
    d.minParty,
    d.maxParty,
    d.durationMinutes,
    d.slotIntervalMinutes,
    d.minNoticeMinutes,
    d.maxDaysAhead,
    d.autoConfirm,
  ];
  await tx.query(
    `INSERT INTO reservation_settings (organization_id, establishment_id, public_enabled, min_party, max_party,
       duration_minutes, slot_interval_minutes, min_notice_minutes, max_days_ahead, auto_confirm)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (establishment_id) DO UPDATE SET
       public_enabled = EXCLUDED.public_enabled, min_party = EXCLUDED.min_party, max_party = EXCLUDED.max_party,
       duration_minutes = EXCLUDED.duration_minutes, slot_interval_minutes = EXCLUDED.slot_interval_minutes,
       min_notice_minutes = EXCLUDED.min_notice_minutes, max_days_ahead = EXCLUDED.max_days_ahead,
       auto_confirm = EXCLUDED.auto_confirm`,
    [ctx.organizationId, establishmentId, ...values],
  );
  await recordAudit(tx, ctx, {
    action: "reservation_settings.updated",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { publicEnabled: d.publicEnabled },
  });
  return getReservationSettings(tx, ctx, establishmentId);
}
