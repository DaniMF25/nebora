import "server-only";
import { z } from "zod";
import { toCsv, type CsvCell } from "@/lib/csv";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import { addDays, isValidLocalDate, localDateOf } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import type { Permission } from "@/server/tenancy/permissions";
import { isUuid, parseInput } from "@/server/validation";

// Exportaciones a CSV (D-058). Cada exportación exige «data.export» y el
// permiso de lectura de su módulo (que ya depende del plan); RLS limita las
// filas a la organización y a los locales a los que accede la cuenta. Se
// registran en la auditoría con el tipo, el local, el periodo y las filas.

export const EXPORT_KINDS = ["reservations", "messages", "shifts", "stock", "movements"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_PERMISSION: Record<ExportKind, Permission> = {
  reservations: "reservations.read",
  messages: "messages.read",
  shifts: "staff.read",
  stock: "inventory.read",
  movements: "inventory.read",
};

/** Exportaciones sin periodo (foto del momento). */
export const SNAPSHOT_KINDS: readonly ExportKind[] = ["stock"];

export const MAX_EXPORT_DAYS = 366;
export const MAX_EXPORT_ROWS = 50_000;

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (EXPORT_KINDS as readonly string[]).includes(value);
}

/** Exportaciones que la cuenta puede hacer (para mostrar solo esas en el panel). */
export function availableExports(ctx: TenantContext): ExportKind[] {
  if (!ctx.permissions.has("data.export")) return [];
  return EXPORT_KINDS.filter((k) => ctx.permissions.has(EXPORT_PERMISSION[k]));
}

const dateSchema = z.string().refine(isValidLocalDate, { message: "Fecha no válida" });
const exportSchema = z
  .object({
    // "" = todos los locales a los que se accede.
    establishmentId: z.union([z.literal(""), z.string().refine(isUuid, { message: "Local no válido" })]).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict();

export interface CsvExport {
  filename: string;
  csv: string;
  rows: number;
}

const RESERVATION_STATUS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Finalizada",
  cancelled: "Cancelada",
  no_show: "No presentada",
};
const MESSAGE_TOPIC: Record<string, string> = {
  group: "Reserva de grupo",
  event: "Evento o celebración",
  allergies: "Alergias e intolerancias",
  other: "Otra consulta",
};
const MESSAGE_STATUS: Record<string, string> = { new: "Sin leer", read: "Leído", archived: "Archivado" };
const MOVEMENT_KIND: Record<string, string> = {
  receipt: "Entrada",
  consumption: "Consumo",
  waste: "Merma",
  adjustment: "Ajuste",
  correction: "Corrección",
  transfer_out: "Traspaso (salida)",
  transfer_in: "Traspaso (entrada)",
  count: "Recuento",
};
const UNIT: Record<string, string> = { g: "g", ml: "ml", unit: "ud." };

function hhmm(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    instant,
  );
}

/** Fecha y hora locales «AAAA-MM-DD HH:MM» (orden correcto al ordenar en la hoja). */
function localDateTime(instant: Date, timeZone: string): string {
  return `${localDateOf(instant, timeZone)} ${hhmm(instant, timeZone)}`;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Genera el CSV de una exportación. El periodo (desde/hasta, ambos incluidos)
 * se interpreta en la hora de cada local y es obligatorio salvo en el stock.
 */
export async function exportCsv(tx: Tx, ctx: TenantContext, kind: ExportKind, input: unknown): Promise<CsvExport> {
  requirePermission(ctx, "data.export");
  requirePermission(ctx, EXPORT_PERMISSION[kind]);
  const data = parseInput(exportSchema, input);
  const establishmentId = data.establishmentId || null;
  let establishmentSlug = "todos";
  if (establishmentId) {
    const { rows } = await tx.query<{ slug: string }>(
      "SELECT slug::text AS slug FROM establishments WHERE organization_id = $1 AND id = $2",
      [ctx.organizationId, establishmentId],
    );
    if (!rows[0]) throw new NotFoundError();
    establishmentSlug = rows[0].slug;
  }
  const snapshot = SNAPSHOT_KINDS.includes(kind);
  let from = data.from ?? null;
  let to = data.to ?? null;
  if (!snapshot) {
    if (!from || !to) throw new ValidationError("Indica el periodo", { from: ["Obligatorio"] });
    if (from > to) throw new ValidationError("La fecha de inicio es posterior a la de fin", { to: ["Revisa el periodo"] });
    if (addDays(from, MAX_EXPORT_DAYS) <= to) {
      throw new ValidationError(`El periodo no puede superar ${MAX_EXPORT_DAYS} días`, { to: ["Periodo demasiado largo"] });
    }
  } else {
    from = to = null;
  }
  const params = [ctx.organizationId, establishmentId, from, to, MAX_EXPORT_ROWS + 1];
  const { header, rows } = await QUERIES[kind](tx, params);
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new ValidationError(`Hay más de ${MAX_EXPORT_ROWS} filas: acota el periodo o elige un local`);
  }
  await recordAudit(tx, ctx, {
    action: "data.exported",
    entityType: "export",
    entityId: null,
    metadata: { kind, establishmentId, from, to, rows: rows.length },
  });
  const period = snapshot ? new Date().toISOString().slice(0, 10) : `${from}_${to}`;
  return { filename: `${FILE_NAMES[kind]}-${establishmentSlug}-${period}.csv`, csv: toCsv(header, rows), rows: rows.length };
}

const FILE_NAMES: Record<ExportKind, string> = {
  reservations: "reservas",
  messages: "mensajes",
  shifts: "turnos",
  stock: "stock",
  movements: "movimientos",
};

type Query = (tx: Tx, params: unknown[]) => Promise<{ header: string[]; rows: CsvCell[][] }>;

// Filtro común: $1 organización, $2 local (o null), $3/$4 periodo local, $5 límite.
const QUERIES: Record<ExportKind, Query> = {
  async reservations(tx, params) {
    const { rows } = await tx.query<{
      establishment: string;
      timezone: string;
      startsAt: Date;
      endsAt: Date;
      partySize: number;
      status: string;
      customerName: string;
      customerPhone: string | null;
      customerEmail: string | null;
      notes: string | null;
      tables: string | null;
      source: string;
      createdAt: Date;
    }>(
      `SELECT e.name AS establishment, e.timezone, r.starts_at AS "startsAt", r.ends_at AS "endsAt",
              r.party_size AS "partySize", r.status, r.customer_name AS "customerName",
              r.customer_phone AS "customerPhone", r.customer_email AS "customerEmail", r.notes,
              (SELECT string_agg(t.name, ', ' ORDER BY t.name)
                 FROM reservation_tables rt
                 JOIN dining_tables t ON t.organization_id = rt.organization_id AND t.id = rt.table_id
                WHERE rt.organization_id = r.organization_id AND rt.reservation_id = r.id) AS tables,
              r.source, r.created_at AS "createdAt"
         FROM reservations r
         JOIN establishments e ON e.organization_id = r.organization_id AND e.id = r.establishment_id
        WHERE r.organization_id = $1 AND ($2::uuid IS NULL OR r.establishment_id = $2)
          AND (r.starts_at AT TIME ZONE e.timezone)::date BETWEEN $3::date AND $4::date
        ORDER BY r.starts_at, e.name, r.id
        LIMIT $5`,
      params,
    );
    return {
      header: [
        "Local",
        "Fecha",
        "Hora",
        "Hasta",
        "Comensales",
        "Estado",
        "Nombre",
        "Teléfono",
        "Correo",
        "Notas",
        "Mesas",
        "Origen",
        "Creada",
      ],
      rows: rows.map((r) => [
        r.establishment,
        localDateOf(r.startsAt, r.timezone),
        hhmm(r.startsAt, r.timezone),
        hhmm(r.endsAt, r.timezone),
        r.partySize,
        RESERVATION_STATUS[r.status] ?? r.status,
        r.customerName,
        r.customerPhone,
        r.customerEmail,
        r.notes,
        r.tables,
        r.source === "public" ? "Web" : "Panel",
        localDateTime(r.createdAt, r.timezone),
      ]),
    };
  },

  async messages(tx, params) {
    const { rows } = await tx.query<{
      establishment: string;
      timezone: string;
      createdAt: Date;
      topic: string | null;
      customerName: string;
      customerPhone: string | null;
      customerEmail: string | null;
      message: string | null;
      status: string;
    }>(
      `SELECT e.name AS establishment, e.timezone, m.created_at AS "createdAt", m.topic,
              m.customer_name AS "customerName", m.customer_phone AS "customerPhone",
              m.customer_email AS "customerEmail", m.message, m.status
         FROM contact_messages m
         JOIN establishments e ON e.organization_id = m.organization_id AND e.id = m.establishment_id
        WHERE m.organization_id = $1 AND ($2::uuid IS NULL OR m.establishment_id = $2)
          AND m.anonymized_at IS NULL
          AND (m.created_at AT TIME ZONE e.timezone)::date BETWEEN $3::date AND $4::date
        ORDER BY m.created_at, e.name, m.id
        LIMIT $5`,
      params,
    );
    return {
      header: ["Local", "Recibido", "Motivo", "Nombre", "Teléfono", "Correo", "Mensaje", "Estado"],
      rows: rows.map((m) => [
        m.establishment,
        localDateTime(m.createdAt, m.timezone),
        m.topic ? (MESSAGE_TOPIC[m.topic] ?? m.topic) : null,
        m.customerName,
        m.customerPhone,
        m.customerEmail,
        m.message,
        MESSAGE_STATUS[m.status] ?? m.status,
      ]),
    };
  },

  async shifts(tx, params) {
    const { rows } = await tx.query<{
      establishment: string;
      timezone: string;
      person: string;
      position: string | null;
      startsAt: Date;
      endsAt: Date;
      notes: string | null;
    }>(
      `SELECT e.name AS establishment, e.timezone, p.name AS person, coalesce(s.position, p.position) AS position,
              s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.notes
         FROM staff_shifts s
         JOIN staff_members p ON p.organization_id = s.organization_id AND p.id = s.staff_member_id
         JOIN establishments e ON e.organization_id = s.organization_id AND e.id = s.establishment_id
        WHERE s.organization_id = $1 AND ($2::uuid IS NULL OR s.establishment_id = $2)
          AND (s.starts_at AT TIME ZONE e.timezone)::date BETWEEN $3::date AND $4::date
        ORDER BY s.starts_at, e.name, p.name, s.id
        LIMIT $5`,
      params,
    );
    return {
      header: ["Local", "Persona", "Puesto", "Fecha", "De", "A", "Horas", "Notas"],
      rows: rows.map((s) => [
        s.establishment,
        s.person,
        s.position,
        localDateOf(s.startsAt, s.timezone),
        hhmm(s.startsAt, s.timezone),
        hhmm(s.endsAt, s.timezone),
        Math.round(((s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000) * 100) / 100,
        s.notes,
      ]),
    };
  },

  async stock(tx, params) {
    const { rows } = await tx.query<{
      establishment: string;
      warehouse: string;
      ingredient: string;
      quantity: string;
      unit: string;
      reorderLevel: string | null;
    }>(
      `SELECT e.name AS establishment, w.name AS warehouse, i.name AS ingredient, l.quantity::text AS quantity,
              i.base_unit AS unit, i.reorder_level::text AS "reorderLevel"
         FROM stock_levels l
         JOIN warehouses w ON w.organization_id = l.organization_id AND w.id = l.warehouse_id
         JOIN establishments e ON e.organization_id = w.organization_id AND e.id = w.establishment_id
         JOIN ingredients i ON i.organization_id = l.organization_id AND i.id = l.ingredient_id
        WHERE l.organization_id = $1 AND ($2::uuid IS NULL OR w.establishment_id = $2)
          -- Sin periodo: el stock es el de ahora ($3 y $4 llegan vacíos; se nombran para que los tipos cuadren).
          AND ($3::date IS NULL OR $4::date IS NULL OR true)
        ORDER BY e.name, w.name, i.name
        LIMIT $5`,
      params,
    );
    return {
      header: ["Local", "Almacén", "Ingrediente", "Cantidad", "Unidad", "Mínimo", "Bajo mínimo"],
      rows: rows.map((l) => {
        const quantity = Number(l.quantity);
        const min = num(l.reorderLevel);
        return [
          l.establishment,
          l.warehouse,
          l.ingredient,
          quantity,
          UNIT[l.unit] ?? l.unit,
          min,
          min !== null && quantity < min ? "Sí" : "No",
        ];
      }),
    };
  },

  async movements(tx, params) {
    const { rows } = await tx.query<{
      establishment: string;
      timezone: string;
      warehouse: string;
      createdAt: Date;
      ingredient: string;
      kind: string;
      delta: string;
      unit: string;
      note: string | null;
      createdBy: string | null;
    }>(
      `SELECT e.name AS establishment, e.timezone, w.name AS warehouse, m.created_at AS "createdAt",
              i.name AS ingredient, m.kind, m.quantity_delta::text AS delta, i.base_unit AS unit, m.note,
              u.display_name AS "createdBy"
         FROM stock_movements m
         JOIN warehouses w ON w.organization_id = m.organization_id AND w.id = m.warehouse_id
         JOIN establishments e ON e.organization_id = w.organization_id AND e.id = w.establishment_id
         JOIN ingredients i ON i.organization_id = m.organization_id AND i.id = m.ingredient_id
         LEFT JOIN users u ON u.id = m.created_by_user_id
        WHERE m.organization_id = $1 AND ($2::uuid IS NULL OR w.establishment_id = $2)
          AND (m.created_at AT TIME ZONE e.timezone)::date BETWEEN $3::date AND $4::date
        ORDER BY m.created_at, e.name, m.id
        LIMIT $5`,
      params,
    );
    return {
      header: ["Local", "Almacén", "Fecha", "Ingrediente", "Tipo", "Cantidad", "Unidad", "Nota", "Registrado por"],
      rows: rows.map((m) => [
        m.establishment,
        m.warehouse,
        localDateTime(m.createdAt, m.timezone),
        m.ingredient,
        MOVEMENT_KIND[m.kind] ?? m.kind,
        Number(m.delta),
        UNIT[m.unit] ?? m.unit,
        m.note,
        m.createdBy,
      ]),
    };
  },
};
