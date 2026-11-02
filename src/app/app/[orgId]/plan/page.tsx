import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getOrganization } from "@/server/modules/organizations/service";
import { withTenant } from "@/server/tenancy/context";
import type { Plan } from "@/server/tenancy/permissions";
import styles from "./plan.module.css";
import { changePlanAction } from "./actions";

/** Lo que añade cada plan al anterior (D-046). */
const PLAN_INFO: { id: Plan; name: string; summary: string; features: string[] }[] = [
  {
    id: "basic",
    name: "Básico",
    summary: "Para tener web y carta en poco tiempo.",
    features: [
      "Web pública del restaurante con contacto, horario y galería",
      "Cartas digitales con QR, traducciones y precios por formato",
      "Estadísticas de visitas",
      "Privacidad y datos de clientes",
      "Una sola persona en el panel",
    ],
  },
  {
    id: "advanced",
    name: "Avanzado",
    summary: "Todo lo del Básico, más la operativa de sala.",
    features: [
      "Reservas online y en el panel, con lista de espera",
      "Plano de sala con mesas",
      "Miembros del equipo con roles y acceso por local",
      "Personal y cuadrante de turnos",
    ],
  },
  {
    id: "pro",
    name: "PRO",
    summary: "Todo lo del Avanzado, más la gestión de cocina.",
    features: [
      "Catálogo de productos con recetas, escandallos y costes",
      "Inventario: ingredientes, almacenes, movimientos y recuentos",
      "Proveedores y pedidos de compra",
    ],
  },
];

export default async function PlanPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      if (ctx.role !== "owner" && ctx.role !== "admin") throw new ForbiddenError();
      return { org: await getOrganization(tx, ctx), isOwner: ctx.role === "owner" };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { org, isOwner } = data;
  const current = PLAN_INFO.find((p) => p.id === org.plan)!;

  return (
    <section>
      <h2>Plan</h2>
      <p>
        Plan actual: <strong>{current.name}</strong>
      </p>
      <p className="notice">
        Todavía no hay cobros configurados: el cambio de plan es inmediato y no se cobra nada. Bajar de plan no borra
        datos: solo deja de mostrar esas secciones, y vuelven al subir de nuevo.
      </p>
      <ActionForm
        action={changePlanAction.bind(null, orgId)}
        submitLabel="Cambiar de plan"
        resetOnSuccess={false}
        className="form form-wide"
      >
        <fieldset className={styles.plans} disabled={!isOwner}>
          <legend className="visually-hidden">Plan de la organización</legend>
          {PLAN_INFO.map((p) => (
            <label key={p.id} className={styles.plan}>
              <span className={styles.head}>
                <input type="radio" name="plan" value={p.id} defaultChecked={p.id === org.plan} />
                <strong>{p.name}</strong>
                {p.id === org.plan && <span className="badge badge-ok">Actual</span>}
              </span>
              <span className="muted">{p.summary}</span>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </label>
          ))}
        </fieldset>
        <p className="muted">
          Al bajar a Básico se desactiva la reserva online de todos los locales, y antes hay que quitar a los demás
          miembros y revocar las invitaciones abiertas.
          {!isOwner && " Solo el propietario puede cambiar el plan."}
        </p>
      </ActionForm>
    </section>
  );
}
