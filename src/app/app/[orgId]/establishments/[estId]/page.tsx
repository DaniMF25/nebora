import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SLOTS_PER_DAY_IN_FORM, WEEKDAY_LABELS } from "@/lib/schedule-form";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { MENU_THEMES, MENU_THEME_LABELS } from "@/lib/menu-snapshot";
import { getEstablishment } from "@/server/modules/establishments/service";
import { listMenus } from "@/server/modules/menus/menus";
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
import { createMenuAction, deleteExceptionAction, saveExceptionAction, saveWeeklyHoursAction } from "./actions";

function SlotInputs({ prefix, slots, label }: { prefix: string; slots: Slot[]; label: string }) {
  return (
    <>
      {Array.from({ length: SLOTS_PER_DAY_IN_FORM }, (_, n) => {
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

export default async function EstablishmentPage({
  params,
}: {
  params: Promise<{ orgId: string; estId: string }>;
}) {
  const { orgId, estId } = await params;
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
        menus: ctx.permissions.has("menus.read") ? await listMenus(tx, ctx, estId) : [],
        canEditMenus: ctx.permissions.has("menus.edit"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { establishment: est, schedule, today, canEdit, menus, canEditMenus } = data;
  const tz = est.timezone;
  const now = new Date();
  const openNow = isOpenAt(schedule, tz, now);
  const upcoming = resolveOpeningIntervals(schedule, tz, today, 7);
  const fmt = new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtTime = new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <p>
        <Link href={`/app/${orgId}`}>← Establecimientos</Link>
      </p>
      <h2>{est.name}</h2>
      <p className="muted">
        Zona horaria: {tz}
        {est.address && <> · {est.address}</>}
      </p>
      <p>
        <strong>{openNow ? "Abierto ahora" : "Cerrado ahora"}</strong>{" "}
        <span className="muted">(hora local {fmtTime.format(now)})</span>
      </p>

      <section>
        <h3>Cartas</h3>
        {menus.length === 0 ? (
          <p className="muted">Este establecimiento aún no tiene cartas.</p>
        ) : (
          <ul className="cards">
            {menus.map((m) => (
              <li key={m.id}>
                <Link href={`/app/${orgId}/menus/${m.id}`}>
                  <strong>{m.name}</strong>
                </Link>{" "}
                <span className="muted">
                  · {m.publishedVersionNumber ? `publicada (v${m.publishedVersionNumber})` : "sin publicar"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEditMenus && (
          <details>
            <summary>Nueva carta</summary>
            <ActionForm action={createMenuAction.bind(null, orgId, est.id)} submitLabel="Crear carta">
              <label>
                Nombre de la carta
                <input name="name" required maxLength={120} placeholder="Carta principal" />
              </label>
              <label>
                Identificador de la carta (URL)
                <input name="slug" required placeholder="carta" />
              </label>
              <label>
                Tema
                <select name="theme" defaultValue="moderno">
                  {MENU_THEMES.map((t) => (
                    <option key={t} value={t}>
                      {MENU_THEME_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </details>
        )}
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

      <section>
        <h3>Horario semanal</h3>
        <p className="muted">
          Hasta {SLOTS_PER_DAY_IN_FORM} turnos por día. Si el cierre es anterior a la apertura, el turno termina al
          día siguiente (p. ej. 20:00–02:00).
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
  );
}
