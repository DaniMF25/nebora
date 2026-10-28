import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ZonePlan } from "@/components/zone-plan";
import { TABLE_SHAPES, TABLE_SHAPE_LABELS, type TableShape } from "@/lib/floor";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { getFloorPlan, type DiningTable } from "@/server/modules/floor/service";
import { withTenant } from "@/server/tenancy/context";
import {
  createTableAction,
  createZoneAction,
  deleteTableAction,
  deleteZoneAction,
  moveTableAction,
  updateTableAction,
  updateZoneAction,
} from "./actions";

function TableFields({ defaults }: { defaults?: Pick<DiningTable, "name" | "minCapacity" | "maxCapacity" | "shape" | "width" | "height"> }) {
  return (
    <>
      <div className="inline-form">
        <label>
          Nombre de la mesa
          <input name="name" required maxLength={20} size={8} defaultValue={defaults?.name} placeholder="M1" />
        </label>
        <label>
          Mínimo
          <input name="minCapacity" type="number" min={1} max={50} defaultValue={defaults?.minCapacity ?? 1} />
        </label>
        <label>
          Máximo
          <input name="maxCapacity" type="number" min={1} max={50} required defaultValue={defaults?.maxCapacity ?? 4} />
        </label>
      </div>
      <div className="inline-form">
        <label>
          Forma
          <select name="shape" defaultValue={defaults?.shape ?? "square"}>
            {TABLE_SHAPES.map((s: TableShape) => (
              <option key={s} value={s}>
                {TABLE_SHAPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ancho (celdas)
          <input name="width" type="number" min={1} max={8} defaultValue={defaults?.width ?? 2} />
        </label>
        <label>
          Fondo (celdas)
          <input name="height" type="number" min={1} max={8} defaultValue={defaults?.height ?? 2} />
        </label>
      </div>
    </>
  );
}

export default async function FloorPage({ params }: { params: Promise<{ orgId: string; estId: string }> }) {
  const { orgId, estId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: await getEstablishment(tx, ctx, estId),
      plan: await getFloorPlan(tx, ctx, estId),
      canManage: ctx.permissions.has("tables.manage"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, plan, canManage } = data;

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${estId}`}>← {establishment.name}</Link>
      </p>
      <h2>Plano de sala</h2>
      <p className="muted">
        {plan.activeTables} mesas activas · {plan.totalSeats} plazas
        {canManage && " · Arrastra las mesas o selecciónalas y usa las flechas del teclado para moverlas."}
      </p>

      {plan.zones.length === 0 && <p className="muted">Todavía no hay zonas. Crea la primera (p. ej. Comedor o Terraza).</p>}

      {plan.zones.map((zone) => {
        const seats = zone.tables.filter((t) => t.active).reduce((s, t) => s + t.maxCapacity, 0);
        return (
          <section key={zone.id} className="zone">
            <h3>
              {zone.name} <span className="muted">· {zone.tables.length} mesas · {seats} plazas</span>
            </h3>
            <ZonePlan
              // Se vuelve a montar cuando cambian los datos del servidor.
              key={JSON.stringify(zone)}
              zoneName={zone.name}
              planWidth={zone.planWidth}
              planHeight={zone.planHeight}
              tables={zone.tables}
              canManage={canManage}
              moveAction={moveTableAction.bind(null, orgId, estId)}
            />
            {canManage && (
              <>
                <details>
                  <summary>Nueva mesa en {zone.name}</summary>
                  <ActionForm action={createTableAction.bind(null, orgId, estId, zone.id)} submitLabel="Crear mesa">
                    <TableFields />
                  </ActionForm>
                </details>
                {zone.tables.length > 0 && (
                  <details>
                    <summary>Editar mesas de {zone.name}</summary>
                    <ul className="cards">
                      {zone.tables.map((t) => (
                        <li key={t.id}>
                          <ActionForm
                            action={updateTableAction.bind(null, orgId, estId, t.id)}
                            submitLabel={`Guardar ${t.name}`}
                            secondary={{
                              action: deleteTableAction.bind(null, orgId, estId, t.id),
                              label: `Eliminar ${t.name}`,
                            }}
                          >
                            <TableFields defaults={t} />
                            <label className="inline-form">
                              <input type="checkbox" name="active" defaultChecked={t.active} /> Activa
                            </label>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <details>
                  <summary>Ajustes de {zone.name}</summary>
                  <ActionForm
                    action={updateZoneAction.bind(null, orgId, estId, zone.id)}
                    submitLabel="Guardar zona"
                    secondary={{
                      action: deleteZoneAction.bind(null, orgId, estId, zone.id),
                      label: `Eliminar zona ${zone.name}`,
                    }}
                  >
                    <ZoneFields name={zone.name} width={zone.planWidth} height={zone.planHeight} />
                  </ActionForm>
                </details>
              </>
            )}
          </section>
        );
      })}

      {canManage && (
        <section>
          <h3>Nueva zona</h3>
          <ActionForm action={createZoneAction.bind(null, orgId, estId)} submitLabel="Crear zona">
            <ZoneFields />
          </ActionForm>
        </section>
      )}
    </>
  );
}

function ZoneFields({ name, width, height }: { name?: string; width?: number; height?: number }) {
  return (
    <div className="inline-form">
      <label>
        Nombre de la zona
        <input name="name" required maxLength={60} defaultValue={name} placeholder="Terraza" />
      </label>
      <label>
        Ancho del plano
        <input name="planWidth" type="number" min={4} max={40} defaultValue={width ?? 16} />
      </label>
      <label>
        Fondo del plano
        <input name="planHeight" type="number" min={4} max={40} defaultValue={height ?? 10} />
      </label>
    </div>
  );
}
