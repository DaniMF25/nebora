import "server-only";
import type { Tx } from "@/server/db/pool";
import { getPool } from "@/server/db/pool";
import { ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { addDays, localDateOf } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";

// ---------------------------------------------------------------------------
// Registro (páginas públicas, sin sesión)
// ---------------------------------------------------------------------------

const publicSlug = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/**
 * Suma una visita. Nunca falla hacia fuera: una estadística perdida no debe
 * romper la página pública. Devuelve si se contó (solo contenido publicado).
 */
async function record(sql: string, args: string[]): Promise<boolean> {
  try {
    const { rows } = await getPool().query<{ ok: boolean }>(sql, args);
    return rows[0]?.ok === true;
  } catch (err) {
    console.error("[stats] no se pudo registrar la visita", {
      message: err instanceof Error ? err.message : "desconocido",
    });
    return false;
  }
}

export function recordSiteView(orgSlug: string, establishmentSlug: string): Promise<boolean> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => publicSlug.test(s))) return Promise.resolve(false);
  return record("SELECT app.record_site_view($1, $2) AS ok", slugs);
}

export function recordMenuView(orgSlug: string, establishmentSlug: string, menuSlug: string): Promise<boolean> {
  const slugs = [orgSlug, establishmentSlug, menuSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => publicSlug.test(s))) return Promise.resolve(false);
  return record("SELECT app.record_menu_view($1, $2, $3) AS ok", slugs);
}

export function recordQrScan(code: string): Promise<boolean> {
  if (!/^[0-9a-f]{12}$/.test(code)) return Promise.resolve(false);
  return record("SELECT app.record_qr_scan($1) AS ok", [code]);
}

// ---------------------------------------------------------------------------
// Consulta (panel)
// ---------------------------------------------------------------------------

export const STATS_PERIODS = [7, 30, 90] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export interface DailyViews {
  /** Día local del establecimiento (AAAA-MM-DD). */
  date: string;
  site: number;
  menu: number;
  qr: number;
}

export interface MenuViews {
  menuId: string;
  name: string;
  published: boolean;
  views: number;
  qr: number;
}

export interface EstablishmentStats {
  from: string;
  to: string;
  days: DailyViews[];
  totals: { site: number; menu: number; qr: number };
  menus: MenuViews[];
  /** Reservas con inicio en el periodo. null sin reservations.read. */
  reservations: {
    total: number;
    online: number;
    covers: number;
    cancelled: number;
    noShow: number;
  } | null;
}

/**
 * Visitas por día del local en los últimos `period` días (incluido hoy, en su
 * zona horaria) y reservas con inicio en ese periodo.
 */
export async function getEstablishmentStats(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  period: number,
  now = new Date(),
): Promise<EstablishmentStats> {
  requirePermission(ctx, "stats.read");
  if (!(STATS_PERIODS as readonly number[]).includes(period)) throw new ValidationError("Periodo no válido");
  const est = await getEstablishment(tx, ctx, establishmentId);
  const to = localDateOf(now, est.timezone);
  const from = addDays(to, -(period - 1));

  const { rows: dayRows } = await tx.query<{
    day: string;
    kind: "site" | "menu" | "qr";
    views: number;
  }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, sum(views)::int AS views
       FROM page_view_daily
      WHERE organization_id = $1 AND establishment_id = $2 AND day BETWEEN $3::date AND $4::date
      GROUP BY day, kind`,
    [ctx.organizationId, est.id, from, to],
  );
  const byDay = new Map<string, DailyViews>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, { date: d, site: 0, menu: 0, qr: 0 });
  for (const r of dayRows) {
    const day = byDay.get(r.day);
    if (day) day[r.kind] += r.views;
  }
  const days = [...byDay.values()];
  const totals = days.reduce(
    (t, d) => ({
      site: t.site + d.site,
      menu: t.menu + d.menu,
      qr: t.qr + d.qr,
    }),
    { site: 0, menu: 0, qr: 0 },
  );

  const { rows: menuRows } = await tx.query<MenuViews>(
    `SELECT m.id AS "menuId", m.name, m.published_version_id IS NOT NULL AS published,
            coalesce(sum(v.views) FILTER (WHERE v.kind = 'menu'), 0)::int AS views,
            coalesce(sum(v.views) FILTER (WHERE v.kind = 'qr'), 0)::int AS qr
       FROM menus m
       LEFT JOIN page_view_daily v ON v.organization_id = m.organization_id AND v.menu_id = m.id
                                  AND v.day BETWEEN $3::date AND $4::date
      WHERE m.organization_id = $1 AND m.establishment_id = $2
      GROUP BY m.id
      ORDER BY views DESC, m.name`,
    [ctx.organizationId, est.id, from, to],
  );

  let reservations: EstablishmentStats["reservations"] = null;
  if (ctx.permissions.has("reservations.read")) {
    const { rows } = await tx.query<NonNullable<EstablishmentStats["reservations"]>>(
      `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show'))::int AS total,
              count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show') AND source = 'public')::int AS online,
              coalesce(sum(party_size) FILTER (WHERE status NOT IN ('cancelled', 'no_show')), 0)::int AS covers,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              count(*) FILTER (WHERE status = 'no_show')::int AS "noShow"
         FROM reservations
        WHERE organization_id = $1 AND establishment_id = $2
          AND (starts_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date`,
      [ctx.organizationId, est.id, from, to, est.timezone],
    );
    reservations = rows[0]!;
  }

  return { from, to, days, totals, menus: menuRows, reservations };
}
