import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { formatQuantity } from "@/lib/quantity";
import { unreadMessageCounts } from "@/server/modules/contact/service";
import { getDashboard, type Dashboard } from "@/server/modules/dashboard/service";
import { addDays, localDateOf } from "@/server/modules/schedules/time";
import { listMyShifts, MY_SHIFTS_DAYS, type MyShift } from "@/server/modules/staff/service";
import { withTenant } from "@/server/tenancy/context";
import { createEstablishmentAction } from "./actions";
import { OpenStatus } from "@/components/panel/open-status";

export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      dashboard: await getDashboard(tx, ctx),
      // Mensajes de contacto sin leer por local (D-049); vacío sin permiso.
      unread: Object.fromEntries(await unreadMessageCounts(tx, ctx)),
      // Turnos propios (ficha vinculada a esta cuenta); null si no hay ficha o el plan no incluye turnos.
      myShifts: ctx.permissions.has("staff.read") ? await listMyShifts(tx, ctx) : null,
      // Solo controla qué se muestra; el servidor vuelve a comprobarlo en la acción.
      canCreate: ctx.permissions.has("establishments.create"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <>
      {data.myShifts && <MyShifts orgId={orgId} shifts={data.myShifts} />}
      <Today orgId={orgId} dashboard={data.dashboard} unread={data.unread} />
      <Alerts orgId={orgId} dashboard={data.dashboard} />
      {data.canCreate && (
        <section>
          <h2>Nuevo establecimiento</h2>
          <ActionForm action={createEstablishmentAction.bind(null, orgId)} submitLabel="Crear establecimiento">
            <label>
              Nombre
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Identificador (URL)
              <input name="slug" required placeholder="centro" />
            </label>
            <label>
              Zona horaria
              <input name="timezone" defaultValue="Europe/Madrid" required />
            </label>
            <label>
              Dirección (opcional)
              <input name="address" maxLength={300} />
            </label>
          </ActionForm>
        </section>
      )}
    </>
  );
}

const MAX_LISTED = 5;

/** «Hoy», «Mañana» o el día abreviado («jue 12 mar»), en la hora del local. */
function dayLabel(s: MyShift, now: Date): string {
  const today = localDateOf(now, s.timezone);
  if (s.date === today) return "Hoy";
  if (s.date === addDays(today, 1)) return "Mañana";
  const label = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${s.date}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Próximos turnos de quien tiene su cuenta vinculada a una ficha del personal (D-054). */
function MyShifts({ orgId, shifts }: { orgId: string; shifts: MyShift[] }) {
  const now = new Date();
  return (
    <section aria-labelledby="mis-turnos">
      <h2 id="mis-turnos">Mis próximos turnos</h2>
      {shifts.length === 0 ? (
        <p className="muted">No tienes turnos en los próximos {MY_SHIFTS_DAYS} días.</p>
      ) : (
        <ul className="my-shifts">
          {shifts.map((s) => (
            <li key={s.id} className={s.ongoing ? "is-ongoing" : undefined}>
              <span className="my-shift-day">
                {dayLabel(s, now)}
                {s.ongoing && <span className="badge badge-ok">Ahora</span>}
              </span>
              <strong className="my-shift-time">
                {s.start}–{s.end}
              </strong>
              <span>
                {s.establishmentName}
                {s.position && <span className="muted"> · {s.position}</span>}
                {s.notes && <span className="muted"> · {s.notes}</span>}
              </span>
              <Link
                href={`/app/${orgId}/establishments/${s.establishmentId}/staff?week=${s.date}`}
                aria-label={`Ver cuadrante: ${dayLabel(s, now)}, ${s.start}–${s.end} en ${s.establishmentName}`}
              >
                Ver cuadrante
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Locales de la organización con su resumen del día (es también la lista de locales). */
function Today({
  orgId,
  dashboard,
  unread,
}: {
  orgId: string;
  dashboard: Dashboard;
  unread: Record<string, number>;
}) {
  return (
    <section aria-labelledby="hoy" className="bare">
      <h2 id="hoy">Hoy</h2>
      {dashboard.establishments.length === 0 && <p className="muted">No hay establecimientos todavía.</p>}
      <div className="dash-grid">
        {dashboard.establishments.map((e) => {
          const time = new Intl.DateTimeFormat("es-ES", { timeZone: e.timezone, hour: "2-digit", minute: "2-digit" });
          const r = e.reservations;
          return (
            <article key={e.id} className="dash-card">
              <h3>
                <Link href={`/app/${orgId}/establishments/${e.id}`}>{e.name}</Link>
              </h3>
              {e.address && <p className="muted">{e.address}</p>}
              <p>
                <OpenStatus open={e.openNow} label={e.openNow ? "Abierto" : "Cerrado"} small />
                {e.nextOpening && <span className="muted"> · abre a las {time.format(e.nextOpening)}</span>}
              </p>
              {(unread[e.id] ?? 0) > 0 && (
                <p>
                  <Link href={`/app/${orgId}/establishments/${e.id}/messages`}>
                    {unread[e.id] === 1 ? "1 mensaje sin leer" : `${unread[e.id]} mensajes sin leer`}
                  </Link>
                </p>
              )}
              {r && (
                <>
                  <dl className="kpis">
                    <div>
                      <dt>Reservas</dt>
                      <dd>{r.active}</dd>
                    </div>
                    <div>
                      <dt>Comensales</dt>
                      <dd>{r.covers}</dd>
                    </div>
                    <div>
                      <dt>Por confirmar</dt>
                      <dd>{r.pending}</dd>
                    </div>
                  </dl>
                  <p className="muted">
                    {r.next
                      ? `Próxima: ${time.format(r.next.startsAt)} · ${r.next.customerName} (${r.next.partySize})`
                      : "No quedan reservas para hoy."}{" "}
                    <Link href={`/app/${orgId}/establishments/${e.id}/reservations`}>Ver reservas</Link>
                  </p>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Alerts({ orgId, dashboard: d }: { orgId: string; dashboard: Dashboard }) {
  const blocks: React.ReactNode[] = [];
  if (d.lowStock && d.lowStock.length > 0) {
    blocks.push(
      <article key="stock" className="dash-card dash-alert">
        <h3>Stock bajo mínimo ({d.lowStock.length})</h3>
        <ul>
          {d.lowStock.slice(0, MAX_LISTED).map((l) => (
            <li key={`${l.warehouseId}-${l.ingredientId}`}>
              {l.ingredientName}{" "}
              <span className="muted">
                · {formatQuantity(l.quantity, l.baseUnit)} en {l.warehouseName}
              </span>
            </li>
          ))}
        </ul>
        <Link href={`/app/${orgId}/inventory`}>Ir a inventario</Link>
      </article>,
    );
  }
  if (d.orders && (d.orders.awaitingReceipt.length > 0 || d.orders.drafts > 0)) {
    blocks.push(
      <article key="orders" className="dash-card">
        <h3>Pedidos pendientes de recibir ({d.orders.awaitingReceipt.length})</h3>
        {d.orders.awaitingReceipt.length > 0 && (
          <ul>
            {d.orders.awaitingReceipt.slice(0, MAX_LISTED).map((o) => (
              <li key={o.id}>
                <Link href={`/app/${orgId}/purchasing/${o.id}`}>
                  Pedido {o.number} · {o.supplierName}
                </Link>
                {o.expectedDate && <span className="muted"> · previsto {o.expectedDate}</span>}
                {o.status === "partially_received" && <span className="muted"> · recibido en parte</span>}
              </li>
            ))}
          </ul>
        )}
        {d.orders.drafts > 0 && (
          <p className="muted">
            {d.orders.drafts} {d.orders.drafts === 1 ? "borrador sin enviar" : "borradores sin enviar"}.
          </p>
        )}
        <Link href={`/app/${orgId}/purchasing`}>Ir a compras</Link>
      </article>,
    );
  }
  if (d.menusToPublish && d.menusToPublish.length > 0) {
    blocks.push(
      <article key="menus" className="dash-card">
        <h3>Cartas por publicar ({d.menusToPublish.length})</h3>
        <ul>
          {d.menusToPublish.slice(0, MAX_LISTED).map((m) => (
            <li key={m.id}>
              <Link href={`/app/${orgId}/menus/${m.id}`}>{m.name}</Link>{" "}
              <span className="muted">
                · {m.establishmentName} · {m.neverPublished ? "nunca publicada" : "cambios sin publicar"}
              </span>
            </li>
          ))}
        </ul>
      </article>,
    );
  }
  if (d.incompleteCostings && d.incompleteCostings.length > 0) {
    blocks.push(
      <article key="costs" className="dash-card">
        <h3>Escandallos incompletos ({d.incompleteCostings.length})</h3>
        <ul>
          {d.incompleteCostings.slice(0, MAX_LISTED).map((p) => (
            <li key={p.id}>
              <Link href={`/app/${orgId}/products/${p.id}`}>{p.name}</Link> <span className="muted">· {p.reason}</span>
            </li>
          ))}
        </ul>
        {d.incompleteCostings.length > MAX_LISTED && <Link href={`/app/${orgId}/products`}>Ver todos</Link>}
      </article>,
    );
  }
  const anyChecked = d.lowStock || d.orders || d.menusToPublish || d.incompleteCostings;
  if (!anyChecked) return null;
  return (
    <section aria-labelledby="avisos" className="bare">
      <h2 id="avisos">Avisos</h2>
      {blocks.length === 0 ? (
        <p className="muted">Todo al día: no hay avisos pendientes.</p>
      ) : (
        <div className="dash-grid">{blocks}</div>
      )}
    </section>
  );
}
