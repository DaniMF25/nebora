import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { OccupancyPlan } from "@/components/occupancy-plan";
import { requireUser } from "@/server/auth/current-user";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { getFloorPlan } from "@/server/modules/floor/service";
import {
  findAvailableTables,
  listReservationsForDay,
  occupancyAt,
  type AvailableTable,
  type Reservation,
  type ReservationStatus,
} from "@/server/modules/reservations/service";
import { addDays, isValidLocalDate, localDateOf, localToUtc, parseTime } from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import { getOrganization } from "@/server/modules/organizations/service";
import { getReservationSettings } from "@/server/modules/reservations/settings";
import { getEnv } from "@/server/config/env";
import { createReservationAction, setStatusAction, updateReservationAction, updateSettingsAction } from "./actions";

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Finalizada",
  cancelled: "Cancelada",
  no_show: "No presentada",
};

const ACTIONS: Partial<Record<ReservationStatus, { to: ReservationStatus; label: string }[]>> = {
  pending: [
    { to: "confirmed", label: "Confirmar" },
    { to: "cancelled", label: "Cancelar" },
  ],
  confirmed: [
    { to: "seated", label: "Sentar" },
    { to: "no_show", label: "No vino" },
    { to: "cancelled", label: "Cancelar" },
  ],
  seated: [{ to: "completed", label: "Finalizar" }],
};

type Search = Promise<{ date?: string; at?: string; time?: string; duration?: string; party?: string }>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function CustomerFields({ r }: { r?: Reservation }) {
  return (
    <>
      <label>
        Nombre del cliente
        <input name="customerName" required maxLength={120} defaultValue={r?.customerName} />
      </label>
      <div className="inline-form">
        <label>
          Teléfono (opcional)
          <input name="customerPhone" type="tel" maxLength={40} defaultValue={r?.customerPhone ?? ""} />
        </label>
        <label>
          Correo (opcional)
          <input name="customerEmail" type="email" maxLength={254} defaultValue={r?.customerEmail ?? ""} />
        </label>
      </div>
      <label>
        Notas (opcional)
        <input name="notes" maxLength={500} defaultValue={r?.notes ?? ""} placeholder="Trona, celiaquía, celebración…" />
      </label>
    </>
  );
}

export default async function ReservationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Search;
}) {
  const { orgId, estId } = await params;
  const sp = await searchParams;
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const establishment = await getEstablishment(tx, ctx, estId);
      const tz = establishment.timezone;
      const today = localDateOf(new Date(), tz);
      const date = isValidLocalDate(one(sp.date) ?? "") ? one(sp.date)! : today;
      const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
      const at = parseTime(one(sp.at) ?? "") !== null ? one(sp.at)! : date === today ? nowTime : "21:00";
      const day = await listReservationsForDay(tx, ctx, estId, date);
      const plan = await getFloorPlan(tx, ctx, estId);
      const occupied = await occupancyAt(tx, ctx, estId, localToUtc(date, parseTime(at)!, tz));

      // Búsqueda de mesas libres (paso 1 del alta).
      let search: { time: string; duration: number; party: number; tables: AvailableTable[] } | null = null;
      let searchError: string | null = null;
      const time = one(sp.time);
      if (time) {
        const duration = Number(one(sp.duration) ?? 90);
        const party = Number(one(sp.party) ?? 2);
        try {
          const result = await findAvailableTables(tx, ctx, estId, { date, time, durationMinutes: duration, partySize: party });
          search = { time, duration, party, tables: result.tables };
        } catch (err) {
          if (err instanceof AppError && !(err instanceof NotFoundError)) searchError = err.message;
          else throw err;
        }
      }
      return {
        establishment,
        tz,
        today,
        date,
        at,
        reservations: day.reservations,
        plan,
        occupied: Object.fromEntries(occupied),
        search,
        searchError,
        canManage: ctx.permissions.has("reservations.manage"),
        canConfigure: ctx.permissions.has("establishments.update"),
        settings: await getReservationSettings(tx, ctx, estId),
        orgSlug: (await getOrganization(tx, ctx)).slug,
        activeTables: plan.zones.flatMap((z) => z.tables.filter((t) => t.active).map((t) => ({ ...t, zoneName: z.name }))),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, tz, today, date, at, reservations, plan, occupied, search, searchError, canManage, activeTables } = data;
  const { settings, canConfigure, orgSlug } = data;
  const publicPath = `/r/${orgSlug}/${establishment.slug}`;
  const baseUrl = getEnv().APP_BASE_URL;
  const base = `/app/${orgId}/establishments/${estId}/reservations`;
  const time = new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const longDate = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const active = reservations.filter((r) => ["pending", "confirmed", "seated"].includes(r.status));
  const covers = active.reduce((s, r) => s + r.partySize, 0);

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${estId}`}>← {establishment.name}</Link>
      </p>
      <h2>Reservas · {longDate.format(new Date(`${date}T12:00:00Z`))}</h2>
      <nav className="inline-form" aria-label="Cambiar de día">
        <Link href={`${base}?date=${addDays(date, -1)}`}>← Día anterior</Link>
        {date !== today && <Link href={`${base}?date=${today}`}>Hoy</Link>}
        <Link href={`${base}?date=${addDays(date, 1)}`}>Día siguiente →</Link>
        <form method="get" className="inline-form">
          <label>
            <span className="visually-hidden">Fecha</span>
            <input type="date" name="date" defaultValue={date} />
          </label>
          <button type="submit">Ir</button>
        </form>
      </nav>
      <p className="muted">
        {active.length} reservas activas · {covers} comensales
      </p>

      <section>
        <h3>Reservas del día</h3>
        {reservations.length === 0 ? (
          <p className="muted">No hay reservas este día.</p>
        ) : (
          <ul className="cards">
            {reservations.map((r) => (
              <li key={r.id} className={`reservation status-${r.status}`}>
                <strong>
                  {time.format(r.startsAt)}–{time.format(r.endsAt)}
                </strong>{" "}
                · {r.customerName} · {r.partySize} pers. ·{" "}
                {r.tables.length ? `Mesa ${r.tables.map((t) => t.name).join(" + ")}` : <em>sin mesa</em>} ·{" "}
                <span className="badge">{STATUS_LABELS[r.status]}</span>
                {r.source === "public" && <span className="badge"> Web</span>}
                {(r.customerPhone || r.notes) && (
                  <div className="muted">{[r.customerPhone, r.notes].filter(Boolean).join(" · ")}</div>
                )}
                {canManage && (
                  <div className="inline-form">
                    {(ACTIONS[r.status] ?? []).map((a) => (
                      <ActionForm
                        key={a.to}
                        action={setStatusAction.bind(null, orgId, estId, r.id, a.to)}
                        submitLabel={`${a.label} (${r.customerName})`}
                        className="inline-form"
                      />
                    ))}
                  </div>
                )}
                {canManage && ["pending", "confirmed", "seated"].includes(r.status) && (
                  <details>
                    <summary>Modificar reserva de {r.customerName}</summary>
                    <ActionForm action={updateReservationAction.bind(null, orgId, estId, r.id)} submitLabel="Guardar cambios">
                      <div className="inline-form">
                        <label>
                          Fecha
                          <input type="date" name="date" required defaultValue={localDateOf(r.startsAt, tz)} />
                        </label>
                        <label>
                          Hora
                          <input type="time" name="time" required defaultValue={hhmm.format(r.startsAt)} />
                        </label>
                        <label>
                          Duración (min)
                          <input
                            type="number"
                            name="durationMinutes"
                            min={15}
                            max={480}
                            step={15}
                            defaultValue={Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000)}
                          />
                        </label>
                        <label>
                          Comensales
                          <input type="number" name="partySize" min={1} max={100} defaultValue={r.partySize} />
                        </label>
                      </div>
                      <fieldset className="allergens">
                        <legend>Mesas</legend>
                        {activeTables.map((t) => (
                          <label key={t.id} className="inline-form">
                            <input
                              type="checkbox"
                              name="tableIds"
                              value={t.id}
                              defaultChecked={r.tables.some((rt) => rt.id === t.id)}
                            />
                            {t.name} ({t.zoneName}, hasta {t.maxCapacity})
                          </label>
                        ))}
                      </fieldset>
                      <CustomerFields r={r} />
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Ocupación a las {at}</h3>
        <form method="get" className="inline-form">
          <input type="hidden" name="date" value={date} />
          <label>
            Hora
            <input type="time" name="at" defaultValue={at} />
          </label>
          <button type="submit">Ver ocupación</button>
        </form>
        {plan.zones.length === 0 ? (
          <p className="muted">
            No hay mesas. <Link href={`/app/${orgId}/establishments/${estId}/floor`}>Configura el plano de sala</Link>.
          </p>
        ) : (
          plan.zones.map((z) => (
            <div key={z.id}>
              <h4>{z.name}</h4>
              <OccupancyPlan
                zoneName={z.name}
                planWidth={z.planWidth}
                planHeight={z.planHeight}
                tables={z.tables}
                occupied={occupied}
              />
            </div>
          ))
        )}
      </section>

      {canManage && (
        <section>
          <h3>Nueva reserva</h3>
          <form method="get" className="form">
            <input type="hidden" name="date" value={date} />
            <div className="inline-form">
              <label>
                Hora
                <input type="time" name="time" required defaultValue={search?.time ?? "21:00"} />
              </label>
              <label>
                Duración (min)
                <input type="number" name="duration" min={15} max={480} step={15} defaultValue={search?.duration ?? 90} />
              </label>
              <label>
                Comensales
                <input type="number" name="party" min={1} max={100} defaultValue={search?.party ?? 2} />
              </label>
            </div>
            <button type="submit">Buscar mesas libres</button>
          </form>
          {searchError && <p className="alert">{searchError}</p>}
          {search && (
            <ActionForm action={createReservationAction.bind(null, orgId, estId)} submitLabel="Crear reserva">
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <input type="hidden" name="date" value={date} readOnly />
              <input type="hidden" name="time" value={search.time} readOnly />
              <input type="hidden" name="durationMinutes" value={search.duration} readOnly />
              <input type="hidden" name="partySize" value={search.party} readOnly />
              <p>
                {search.party} personas a las {search.time} ({search.duration} min).{" "}
                {search.tables.length === 0
                  ? "No queda ninguna mesa libre: puedes crear la reserva sin mesa (pendiente)."
                  : "Elige una o varias mesas libres:"}
              </p>
              {search.tables.length > 0 && (
                <fieldset className="allergens">
                  <legend>Mesas libres</legend>
                  {search.tables.map((t) => (
                    <label key={t.id} className="inline-form">
                      <input type="checkbox" name="tableIds" value={t.id} />
                      {t.name} ({t.zoneName}, {t.minCapacity}–{t.maxCapacity})
                    </label>
                  ))}
                </fieldset>
              )}
              <CustomerFields />
              <label>
                Estado
                <select name="status" defaultValue="confirmed">
                  <option value="confirmed">Confirmada</option>
                  <option value="pending">Pendiente</option>
                </select>
              </label>
            </ActionForm>
          )}
        </section>
      )}
      {canConfigure && (
        <section>
          <h3>Reservas online</h3>
          <p>
            {settings.publicEnabled ? (
              <>
                <strong>Activadas.</strong> Página pública:{" "}
                <a href={publicPath} target="_blank" rel="noopener">
                  {baseUrl ? `${baseUrl}${publicPath}` : publicPath}
                </a>
              </>
            ) : (
              <strong>Desactivadas.</strong>
            )}
          </p>
          <details>
            <summary>Configurar reservas online</summary>
            <ActionForm action={updateSettingsAction.bind(null, orgId, estId)} submitLabel="Guardar configuración">
              <label className="inline-form">
                <input type="checkbox" name="publicEnabled" defaultChecked={settings.publicEnabled} /> Aceptar reservas desde
                la web
              </label>
              <div className="inline-form">
                <label>
                  Comensales mínimos
                  <input type="number" name="minParty" min={1} max={50} defaultValue={settings.minParty} />
                </label>
                <label>
                  Comensales máximos
                  <input type="number" name="maxParty" min={1} max={50} defaultValue={settings.maxParty} />
                </label>
                <label>
                  Duración (min)
                  <input type="number" name="durationMinutes" min={30} max={300} step={15} defaultValue={settings.durationMinutes} />
                </label>
              </div>
              <div className="inline-form">
                <label>
                  Intervalo entre horas
                  <select name="slotIntervalMinutes" defaultValue={settings.slotIntervalMinutes}>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>60 min</option>
                  </select>
                </label>
                <label>
                  Antelación mínima (horas)
                  <input type="number" name="minNoticeHours" min={0} max={168} step={0.5} defaultValue={settings.minNoticeMinutes / 60} />
                </label>
                <label>
                  Días vista
                  <input type="number" name="maxDaysAhead" min={1} max={365} defaultValue={settings.maxDaysAhead} />
                </label>
              </div>
              <label className="inline-form">
                <input type="checkbox" name="autoConfirm" defaultChecked={settings.autoConfirm} /> Confirmar automáticamente
                (si no, quedan pendientes de revisión)
              </label>
              <p className="muted">
                Las mesas se asignan automáticamente entre las activas (la más ajustada al grupo). No se envían avisos al
                cliente: no hay proveedor de correo o SMS configurado.
              </p>
            </ActionForm>
          </details>
        </section>
      )}
    </>
  );
}
