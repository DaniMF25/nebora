import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment, listEstablishments } from "@/server/modules/establishments/service";
import { addDays, isValidLocalDate, localDateOf } from "@/server/modules/schedules/time";
import { getWeekRota, listStaffMembers, type Shift, type StaffMember } from "@/server/modules/staff/service";
import { withTenant } from "@/server/tenancy/context";
import { copyPreviousWeekAction, createShiftAction, deleteShiftAction, updateShiftAction } from "./actions";
import { SectionSwitch } from "@/components/panel/section-switch";
import { staffLinks } from "../../../sections";

/** «6 h», «6 h 30 min». */
function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : h === 0 ? `${m} min` : `${h} h ${m} min`;
}

const dayHead = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric" });
const dayLong = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const dayMonth = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const asDate = (d: string) => new Date(`${d}T12:00:00Z`);
const dayOnly = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric" });
const dayMonthShort = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "long" });

/** «17 – 23 de junio de 2030» o «30 de junio – 6 de julio de 2030». */
function weekRange(first: string, last: string): string {
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const from = sameMonth ? dayOnly : sameYear ? dayMonthShort : dayMonth;
  return `${from.format(asDate(first))} – ${dayMonth.format(asDate(last))}`;
}

function ShiftFields({ staff, s, defaultDate }: { staff: StaffMember[]; s?: Shift; defaultDate: string }) {
  return (
    <>
      <div className="inline-form">
        <label>
          Persona
          <select name="staffMemberId" required defaultValue={s?.staffMemberId ?? ""}>
            <option value="" disabled>
              Elige…
            </option>
            {staff.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.position ? ` (${m.position})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Día
          <input type="date" name="date" required defaultValue={s?.date ?? defaultDate} />
        </label>
        <label>
          De
          <input type="time" name="start" required defaultValue={s?.start} />
        </label>
        <label>
          A
          <input type="time" name="end" required defaultValue={s?.end} />
        </label>
      </div>
      <div className="inline-form">
        <label>
          Puesto en este turno (opcional)
          <input name="position" maxLength={40} defaultValue={s?.position ?? ""} placeholder="El de su ficha" />
        </label>
        <label>
          Notas (opcional)
          <input name="notes" maxLength={200} defaultValue={s?.notes ?? ""} />
        </label>
      </div>
    </>
  );
}

export default async function StaffRotaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { orgId, estId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const establishment = await getEstablishment(tx, ctx, estId);
      const today = localDateOf(new Date(), establishment.timezone);
      const week = typeof sp.week === "string" && isValidLocalDate(sp.week) ? sp.week : today;
      return {
        establishment,
        today,
        rota: await getWeekRota(tx, ctx, estId, week),
        staff: await listStaffMembers(tx, ctx, { includeInactive: true }),
        locals: (await listEstablishments(tx, ctx)).map((e) => ({ id: e.id, name: e.name })),
        canManage: ctx.permissions.has("staff.manage"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, today, rota, staff, canManage, locals } = data;
  const base = `/app/${orgId}/establishments/${estId}/staff`;
  const byId = new Map(staff.map((m) => [m.id, m]));
  const active = staff.filter((m) => m.active);
  // Filas: el personal activo y quien tenga turnos esta semana (aunque ya esté desactivado).
  const rows = staff.filter((m) => m.active || rota.minutesByMember[m.id]);
  const thisWeek = rota.days.includes(today);
  const totalMinutes = rota.shifts.reduce((sum, s) => sum + s.minutes, 0);
  const label = (s: Shift) => s.position ?? byId.get(s.staffMemberId)?.position ?? null;
  const name = (id: string) => {
    const m = byId.get(id);
    return m ? `${m.name}${m.userId === user.id ? " (tú)" : ""}` : "—";
  };

  return (
    <>
      <h2>
        Turnos{locals.length > 1 ? ` de ${establishment.name}` : ""} · {weekRange(rota.days[0]!, rota.days[6]!)}
      </h2>
      <SectionSwitch label="Apartados de turnos y horarios" links={staffLinks(orgId, locals, estId)} />
      <nav className="inline-form" aria-label="Cambiar de semana">
        <Link href={`${base}?week=${addDays(rota.weekStart, -7)}`}>← Semana anterior</Link>
        {!thisWeek && <Link href={base}>Esta semana</Link>}
        <Link href={`${base}?week=${addDays(rota.weekStart, 7)}`}>Semana siguiente →</Link>
        <form method="get" className="inline-form">
          <label>
            <span className="visually-hidden">Semana del día</span>
            <input type="date" name="week" defaultValue={rota.weekStart} />
          </label>
          <button type="submit">Ir</button>
        </form>
      </nav>
      <p className="muted">
        {rota.shifts.length === 1 ? "1 turno" : `${rota.shifts.length} turnos`} · {hours(totalMinutes)} en total · Horas
        locales ({establishment.timezone})
      </p>

      {staff.length === 0 ? (
        <p className="notice">
          Para hacer el cuadrante, añade primero a tu equipo en <Link href={`/app/${orgId}/staff`}>Personal</Link>.
        </p>
      ) : (
        <section>
          <h3>Cuadrante</h3>
          <div className="table-wrap">
            <table className="rota">
              <thead>
                <tr>
                  <th>Persona</th>
                  {rota.days.map((d) => (
                    <th key={d} aria-current={d === today ? "date" : undefined}>
                      {dayHead.format(asDate(d))}
                    </th>
                  ))}
                  <th>Horas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <th scope="row" data-label="Persona">
                      {name(m.id)}
                      {m.position && <div className="muted">{m.position}</div>}
                    </th>
                    {rota.days.map((d) => {
                      const mine = rota.shifts.filter((s) => s.staffMemberId === m.id && s.date === d);
                      return (
                        <td
                          key={d}
                          data-label={dayHead.format(asDate(d))}
                          className={mine.length === 0 ? "free" : undefined}
                        >
                          {mine.length === 0 ? (
                            <span className="muted" aria-label="Libre">
                              —
                            </span>
                          ) : (
                            mine.map((s) => (
                              <div key={s.id}>
                                {s.start}–{s.end}
                                {s.position && <span className="muted"> · {s.position}</span>}
                              </div>
                            ))
                          )}
                        </td>
                      );
                    })}
                    <td data-label="Horas">{hours(rota.minutesByMember[m.id] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canManage && active.length > 0 && (
        <section>
          <h3>Añadir turno</h3>
          <p className="muted">Si la hora de fin es anterior a la de inicio, el turno termina al día siguiente.</p>
          <ActionForm
            action={createShiftAction.bind(null, orgId, estId)}
            submitLabel="Añadir turno"
            className="form form-wide"
          >
            <ShiftFields staff={active} defaultDate={thisWeek ? today : rota.weekStart} />
          </ActionForm>
        </section>
      )}

      {canManage && staff.length > 0 && (
        <section>
          <h3>Copiar la semana anterior</h3>
          <p className="muted">
            Copia los turnos de la semana anterior a esta con las mismas horas. No se copian los de personas
            desactivadas ni los que se solaparían con un turno que ya exista (en cualquier local).
          </p>
          <ActionForm
            action={copyPreviousWeekAction.bind(null, orgId, estId, rota.weekStart)}
            submitLabel="Copiar la semana anterior"
          />
        </section>
      )}

      {canManage && rota.shifts.length > 0 && (
        <section>
          <h3>Modificar turnos</h3>
          {rota.days
            .filter((d) => rota.shifts.some((s) => s.date === d))
            .map((d) => (
              <div key={d}>
                <h4>{dayLong.format(asDate(d))}</h4>
                <ul className="cards">
                  {rota.shifts
                    .filter((s) => s.date === d)
                    .map((s) => (
                      <li key={s.id}>
                        <strong>
                          {s.start}–{s.end}
                        </strong>{" "}
                        · {name(s.staffMemberId)}
                        {label(s) && ` · ${label(s)}`} · {hours(s.minutes)}
                        {s.notes && <div className="muted">{s.notes}</div>}
                        <details>
                          <summary>
                            Modificar turno de {byId.get(s.staffMemberId)?.name ?? "—"} ({s.start}–{s.end})
                          </summary>
                          <ActionForm
                            action={updateShiftAction.bind(null, orgId, estId, s.id)}
                            submitLabel="Guardar turno"
                            className="form form-wide"
                            resetOnSuccess={false}
                            secondary={{
                              action: deleteShiftAction.bind(null, orgId, estId, s.id),
                              label: "Eliminar turno",
                            }}
                          >
                            {/* Al modificar se puede elegir también a quien ya está desactivado si era su turno. */}
                            <ShiftFields
                              staff={staff.filter((m) => m.active || m.id === s.staffMemberId)}
                              s={s}
                              defaultDate={s.date}
                            />
                          </ActionForm>
                        </details>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </section>
      )}
    </>
  );
}
