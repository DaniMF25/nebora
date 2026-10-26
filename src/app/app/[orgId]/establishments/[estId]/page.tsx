import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageTabs, pickTab } from "@/components/panel/page-tabs";
import { MAX_SLOTS_PER_DAY, slotFieldsFor, WEEKDAY_LABELS } from "@/lib/schedule-form";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { hasUnpublishedChanges, listMenus } from "@/server/modules/menus/menus";
import { getSchedule } from "@/server/modules/schedules/service";
import {
  formatMinutes,
  isOpenAt,
  localDateOf,
  resolveOpeningIntervals,
  slotClosingTime,
  type Slot,
} from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import {
  deleteExceptionAction,
  saveExceptionAction,
  saveWeeklyHoursAction,
  updateEstablishmentAction,
} from "./actions";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

function SlotInputs({ prefix, slots, label }: { prefix: string; slots: Slot[]; label: string }) {
  return (
    <>
      {Array.from({ length: slotFieldsFor(slots.length) }, (_, n) => {
        const s = slots[n];
        return (
          <span key={n} className="inline-form">
            <input
              type="time"
              name={`${prefix}s${n}o`}
              defaultValue={s ? formatMinutes(s.opensMinute) : ""}
              aria-label={`${label}, turno ${n + 1}, apertura`}
            />
            –
            <input
              type="time"
              name={`${prefix}s${n}c`}
              defaultValue={s ? formatMinutes((s.opensMinute + s.durationMinutes) % 1440) : ""}
              aria-label={`${label}, turno ${n + 1}, cierre`}
            />
          </span>
        );
      })}
    </>
  );
}

function describeSlots(slots: Slot[]): string {
  return slots.map((s) => `${formatMinutes(s.opensMinute)}–${slotClosingTime(s)}`).join(", ");
}

const TABS = ["resumen", "horario", "datos"] as const;

export default async function EstablishmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId, estId } = await params;
  const tab = pickTab((await searchParams).tab, TABS);
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const establishment = await getEstablishment(tx, ctx, estId);
      const today = localDateOf(new Date(), establishment.timezone);
      return {
        establishment,
        today,
        schedule: await getSchedule(tx, ctx, estId, { exceptionsFrom: today }),
        canEdit: ctx.permissions.has("establishments.update"),
        menus: ctx.permissions.has("menus.read")
          ? await Promise.all(
              (await listMenus(tx, ctx, estId)).map(async (m) => ({
                ...m,
                outdated: await hasUnpublishedChanges(tx, ctx, m.id),
              })),
            )
          : [],
        canInventory: ctx.permissions.has("inventory.read"),
        canPurchasing: ctx.permissions.has("purchasing.read"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { establishment: est, schedule, today, canEdit, menus, canInventory, canPurchasing } = data;
  const tz = est.timezone;
  const now = new Date();
  const openNow = isOpenAt(schedule, tz, now);
  const upcoming = resolveOpeningIntervals(schedule, tz, today, 7);
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fmtTime = new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  const base = `/app/${orgId}/establishments/${est.id}`;
  const tabs = [
    { id: "resumen", label: "Resumen" },
    { id: "horario", label: "Horario" },
    ...(canEdit ? [{ id: "datos", label: "Datos del local" }] : []),
  ];

  return (
    <>
      <p>
        <Link href={`/app/${orgId}`}>← Inicio</Link>
      </p>
      <h2>{est.name}</h2>
      <p className="status-line">
        <span className={`badge ${openNow ? "badge-ok" : ""}`}>{openNow ? "Abierto ahora" : "Cerrado ahora"}</span>
        <span className="muted">
          Hora local {fmtTime.format(now)} · {tz}
          {est.address && <> · {est.address}</>}
        </span>
      </p>
      <PageTabs tabs={tabs} current={tab} basePath={base} />

      {tab === "resumen" && (
        <>
          <section className="bare" aria-label="Accesos rápidos">
            <ul className="quick-links">
              <li>
                <Link href={`${base}/reservations`}>
                  <strong>Reservas</strong>
                  <span>Reservas del día, lista de espera y reservas online</span>
                </Link>
              </li>
              <li>
                <Link href={`${base}/floor`} aria-label="Plano de sala (zonas y mesas)">
                  <strong>Sala</strong>
                  <span>Plano de sala (zonas y mesas)</span>
                </Link>
              </li>
              <li>
                <Link href={`${base}/site`} aria-label="Página pública">
                  <strong>Web pública</strong>
                  <span>Diseño, contenido y publicación de tu web</span>
                </Link>
              </li>
              <li>
                <Link href={`${base}/menus`} aria-label="Gestionar cartas">
                  <strong>Cartas</strong>
                  <span>
                    {menus.length === 0
                      ? "Aún no hay cartas"
                      : `${menus.filter((m) => m.publishedVersionNumber).length} de ${menus.length} publicadas`}
                    {menus.some((m) => m.outdated) && " · hay cambios sin publicar"}
                  </span>
                </Link>
              </li>
              {canInventory && (
                <li>
                  <Link href={`${base}/inventory`} aria-label="Inventario del local">
                    <strong>Inventario</strong>
                    <span>Stock, movimientos y recuentos de sus almacenes</span>
                  </Link>
                </li>
              )}
              {canPurchasing && (
                <li>
                  <Link href={`${base}/purchasing`} aria-label="Compras del local">
                    <strong>Compras</strong>
                    <span>Pedidos a proveedores y recepciones</span>
                  </Link>
                </li>
              )}
            </ul>
          </section>
          <section>
            <h3>Próximos 7 días</h3>
            {upcoming.length === 0 ? (
              <p className="muted">Sin horario de apertura configurado para estos días.</p>
            ) : (
              <ul>
                {upcoming.map((iv) => (
                  <li key={iv.start.toISOString()}>
                    {fmt.format(iv.start)} – {fmt.format(iv.end)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "horario" && (
        <>
          <section>
            <h3>Horario semanal</h3>
            <p className="muted">
              Hasta {MAX_SLOTS_PER_DAY} turnos por día: al guardar aparece un hueco más en los días que lo necesiten. Si
              el cierre es anterior a la apertura, el turno termina al día siguiente (p. ej. 20:00–02:00).
            </p>
            {canEdit ? (
              <ActionForm action={saveWeeklyHoursAction.bind(null, orgId, est.id)} submitLabel="Guardar horario">
                <fieldset className="schedule-grid">
                  <legend className="visually-hidden">Turnos por día</legend>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <div key={label} className="schedule-row">
                      <span className="schedule-day">{label}</span>
                      <SlotInputs
                        prefix={`d${i + 1}`}
                        label={label}
                        slots={schedule.weekly.filter((s) => s.weekday === i + 1)}
                      />
                    </div>
                  ))}
                </fieldset>
              </ActionForm>
            ) : (
              <ul>
                {WEEKDAY_LABELS.map((label, i) => {
                  const slots = schedule.weekly.filter((s) => s.weekday === i + 1);
                  return (
                    <li key={label}>
                      {label}: {slots.length ? describeSlots(slots) : "cerrado"}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3>Excepciones (festivos, cierres, horarios especiales)</h3>
            {schedule.exceptions.length === 0 ? (
              <p className="muted">No hay excepciones a partir de hoy.</p>
            ) : (
              <ul className="cards">
                {schedule.exceptions.map((e) => (
                  <li key={e.date}>
                    <strong>{e.date}</strong> · {e.closed ? "Cerrado" : describeSlots(e.slots)}
                    {e.note && <span className="muted"> · {e.note}</span>}
                    {canEdit && (
                      <ActionForm
                        action={deleteExceptionAction.bind(null, orgId, est.id, e.date)}
                        submitLabel={`Eliminar excepción del ${e.date}`}
                        className="inline-form"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <ActionForm action={saveExceptionAction.bind(null, orgId, est.id)} submitLabel="Guardar excepción">
                <label>
                  Fecha
                  <input type="date" name="date" required min={today} />
                </label>
                <label className="inline-form">
                  <input type="checkbox" name="closed" /> Cerrado todo el día
                </label>
                <div>
                  <span>Turnos especiales (si no está cerrado)</span>
                  <SlotInputs prefix="x" label="Excepción" slots={[]} />
                </div>
                <label>
                  Nota (opcional)
                  <input name="note" maxLength={200} />
                </label>
              </ActionForm>
            )}
          </section>
        </>
      )}

      {tab === "datos" && canEdit && (
        <section>
          <h3>Datos del local</h3>
          <ActionForm action={updateEstablishmentAction.bind(null, orgId, est.id)} submitLabel="Guardar datos">
            <label>
              Nombre
              <input name="name" required maxLength={120} defaultValue={est.name} />
            </label>
            <label>
              Dirección
              <input name="address" maxLength={300} defaultValue={est.address ?? ""} />
            </label>
            <label>
              Zona horaria
              <input name="timezone" required list="timezones" defaultValue={est.timezone} />
              <datalist id="timezones">
                {TIMEZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
            <label>
              Identificador (URL)
              <input name="slug" required defaultValue={est.slug} />
            </label>
            <p className="muted">
              Cambiar el identificador cambia las direcciones de la web pública, la carta y las reservas de este local.
              Los códigos QR ya impresos siguen funcionando.
            </p>
          </ActionForm>
        </section>
      )}
    </>
  );
}
