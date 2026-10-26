import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewsChart } from "@/components/panel/views-chart";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { getEstablishmentStats, STATS_PERIODS, type StatsPeriod } from "@/server/modules/stats/service";
import { withTenant } from "@/server/tenancy/context";

const number = new Intl.NumberFormat("es-ES");

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const { orgId, estId } = await params;
  const requested = Number([(await searchParams).days].flat()[0]);
  const period: StatsPeriod = (STATS_PERIODS as readonly number[]).includes(requested)
    ? (requested as StatsPeriod)
    : 30;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: await getEstablishment(tx, ctx, estId),
      stats: await getEstablishmentStats(tx, ctx, estId, period),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment: est, stats } = data;
  const base = `/app/${orgId}/establishments/${est.id}/stats`;
  const views = stats.totals.site + stats.totals.menu;

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${est.id}`}>← {est.name}</Link>
      </p>
      <div className="page-head">
        <div>
          <h2>Estadísticas</h2>
          <p className="muted">
            Del {longDate(stats.from)} al {longDate(stats.to)} (hora local del establecimiento).
          </p>
        </div>
        <nav className="segmented" aria-label="Periodo">
          {STATS_PERIODS.map((p) => (
            <Link key={p} href={p === 30 ? base : `${base}?days=${p}`} aria-current={p === period ? "page" : undefined}>
              {p} días
            </Link>
          ))}
        </nav>
      </div>

      <section>
        <h3>Visitas</h3>
        <dl className="kpis">
          <div>
            <dt>Visitas a la web</dt>
            <dd>{number.format(stats.totals.site)}</dd>
          </div>
          <div>
            <dt>Visitas a las cartas</dt>
            <dd>{number.format(stats.totals.menu)}</dd>
          </div>
          <div>
            <dt>Escaneos de QR</dt>
            <dd>{number.format(stats.totals.qr)}</dd>
          </div>
        </dl>
        {views === 0 ? (
          <p className="muted">
            Aún no hay visitas en este periodo. Se cuentan las visitas a la web y a las cartas publicadas.
          </p>
        ) : (
          <>
            <h4>Páginas vistas por día (web y cartas)</h4>
            <ViewsChart days={stats.days} />
            <details>
              <summary>Ver por días</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Día</th>
                      <th scope="col">Web</th>
                      <th scope="col">Cartas</th>
                      <th scope="col">De ellas, por QR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.days
                      .filter((d) => d.site + d.menu + d.qr > 0)
                      .reverse()
                      .map((d) => (
                        <tr key={d.date}>
                          <th scope="row">{longDate(d.date)}</th>
                          <td>{number.format(d.site)}</td>
                          <td>{number.format(d.menu)}</td>
                          <td>{number.format(d.qr)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <p className="muted fine-print">
          Recuentos orientativos y anónimos: no se usan cookies ni se guarda ningún dato de los visitantes. No cuentan
          las precargas, los robots ni las visitas con la sesión de Nébora iniciada. Abrir la carta desde el QR cuenta
          como escaneo y como visita a la carta.
        </p>
      </section>

      <section>
        <h3>Cartas</h3>
        {stats.menus.length === 0 ? (
          <p className="muted">Este local no tiene cartas.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Carta</th>
                  <th scope="col">Visitas</th>
                  <th scope="col">Escaneos de QR</th>
                </tr>
              </thead>
              <tbody>
                {stats.menus.map((m) => (
                  <tr key={m.menuId}>
                    <th scope="row">
                      <Link href={`/app/${orgId}/menus/${m.menuId}`}>{m.name}</Link>
                      {!m.published && <span className="badge">Sin publicar</span>}
                    </th>
                    <td>{number.format(m.views)}</td>
                    <td>{number.format(m.qr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {stats.reservations && (
        <section>
          <h3>Reservas</h3>
          <p className="muted">Reservas con fecha en el periodo.</p>
          <dl className="kpis">
            <div>
              <dt>Reservas</dt>
              <dd>{number.format(stats.reservations.total)}</dd>
            </div>
            <div>
              <dt>Online</dt>
              <dd>{number.format(stats.reservations.online)}</dd>
            </div>
            <div>
              <dt>Comensales</dt>
              <dd>{number.format(stats.reservations.covers)}</dd>
            </div>
            <div>
              <dt>Canceladas</dt>
              <dd>{number.format(stats.reservations.cancelled)}</dd>
            </div>
            <div>
              <dt>No presentadas</dt>
              <dd>{number.format(stats.reservations.noShow)}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
