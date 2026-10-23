import "server-only";
import type { Tx } from "@/server/db/pool";
import { listEstablishments } from "@/server/modules/establishments/service";
import { listStock, type StockLine } from "@/server/modules/inventory/service";
import { hasUnpublishedChanges, listMenus } from "@/server/modules/menus/menus";
import { listProducts } from "@/server/modules/menus/products";
import { listOrders, type OrderSummary } from "@/server/modules/purchasing/service";
import { listProductCostings } from "@/server/modules/recipes/service";
import { listReservationsForDay } from "@/server/modules/reservations/service";
import { getSchedule } from "@/server/modules/schedules/service";
import { isOpenAt, localDateOf, resolveOpeningIntervals } from "@/server/modules/schedules/time";
import type { TenantContext } from "@/server/tenancy/context";

/**
 * Resumen del día para la portada del panel. Cada bloque se calcula con los
 * servicios de su módulo, que aplican sus propios permisos: un bloque sin
 * permiso es `null` (no se muestra) en lugar de un error.
 */

export interface EstablishmentToday {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  date: string;
  openNow: boolean;
  /** Próxima apertura en las 24 h siguientes si ahora está cerrado. */
  nextOpening: Date | null;
  /** null sin permiso reservations.read. */
  reservations: {
    active: number;
    covers: number;
    pending: number;
    next: { startsAt: Date; customerName: string; partySize: number } | null;
  } | null;
}

export interface Dashboard {
  establishments: EstablishmentToday[];
  lowStock: StockLine[] | null;
  orders: { drafts: number; awaitingReceipt: OrderSummary[] } | null;
  /** Productos activos sin receta o con escandallo incompleto. null sin costs.read. */
  incompleteCostings: { id: string; name: string; reason: "sin receta" | "faltan costes" }[] | null;
  /** Cartas con cambios sin publicar o nunca publicadas. null sin menus.read. */
  menusToPublish: { id: string; name: string; establishmentName: string; neverPublished: boolean }[] | null;
}

const ACTIVE = new Set(["pending", "confirmed", "seated"]);

export async function getDashboard(tx: Tx, ctx: TenantContext, now = new Date()): Promise<Dashboard> {
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const establishments = can("establishments.read") ? await listEstablishments(tx, ctx) : [];

  const today: EstablishmentToday[] = [];
  for (const est of establishments) {
    const date = localDateOf(now, est.timezone);
    const schedule = await getSchedule(tx, ctx, est.id, { exceptionsFrom: date });
    const openNow = isOpenAt(schedule, est.timezone, now);
    const nextOpening = openNow
      ? null
      : (resolveOpeningIntervals(schedule, est.timezone, date, 2).find(
          (iv) => iv.start > now && iv.start.getTime() - now.getTime() <= 24 * 3600_000,
        )?.start ?? null);
    let reservations: EstablishmentToday["reservations"] = null;
    if (can("reservations.read")) {
      const active = (await listReservationsForDay(tx, ctx, est.id, date)).reservations.filter((r) =>
        ACTIVE.has(r.status),
      );
      const upcoming = active.find((r) => r.startsAt > now && r.status !== "seated");
      reservations = {
        active: active.length,
        covers: active.reduce((n, r) => n + r.partySize, 0),
        pending: active.filter((r) => r.status === "pending").length,
        next: upcoming
          ? { startsAt: upcoming.startsAt, customerName: upcoming.customerName, partySize: upcoming.partySize }
          : null,
      };
    }
    today.push({
      id: est.id,
      name: est.name,
      address: est.address,
      timezone: est.timezone,
      date,
      openNow,
      nextOpening,
      reservations,
    });
  }

  const lowStock = can("inventory.read") ? (await listStock(tx, ctx)).filter((l) => l.belowReorder) : null;

  let orders: Dashboard["orders"] = null;
  if (can("purchasing.read")) {
    const all = await listOrders(tx, ctx);
    orders = {
      drafts: all.filter((o) => o.status === "draft").length,
      awaitingReceipt: all.filter((o) => o.status === "sent" || o.status === "partially_received"),
    };
  }

  let incompleteCostings: Dashboard["incompleteCostings"] = null;
  if (can("costs.read") && can("menus.read")) {
    const costings = await listProductCostings(tx, ctx);
    incompleteCostings = (await listProducts(tx, ctx, { activeOnly: true }))
      .map((p) => {
        const c = costings.get(p.id);
        if (!c) return { id: p.id, name: p.name, reason: "sin receta" as const };
        return c.costCents === null ? { id: p.id, name: p.name, reason: "faltan costes" as const } : null;
      })
      .filter((x) => x !== null);
  }

  let menusToPublish: Dashboard["menusToPublish"] = null;
  if (can("menus.read")) {
    menusToPublish = [];
    for (const est of establishments) {
      for (const m of await listMenus(tx, ctx, est.id)) {
        const outdated = await hasUnpublishedChanges(tx, ctx, m.id);
        if (outdated !== false) {
          menusToPublish.push({
            id: m.id,
            name: m.name,
            establishmentName: est.name,
            neverPublished: outdated === null,
          });
        }
      }
    }
  }

  return { establishments: today, lowStock, orders, incompleteCostings, menusToPublish };
}
