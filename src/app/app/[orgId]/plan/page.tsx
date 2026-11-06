import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getOrganization } from "@/server/modules/organizations/service";
import { withTenant } from "@/server/tenancy/context";
import { formatPrice, LOCK_GRACE_DAYS, PLAN_INFO, trialDaysLeft } from "@/lib/plans";
import styles from "./plan.module.css";
import { activatePlanAction, changePlanAction } from "./actions";

export default async function PlanPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      // Bloqueada (D-068): todos los miembros ven el aviso; solo el propietario elige plan.
      if (!ctx.lockedAt && ctx.role !== "owner" && ctx.role !== "admin") throw new ForbiddenError();
      return { org: await getOrganization(tx, ctx), isOwner: ctx.role === "owner" };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { org, isOwner } = data;
  const current = PLAN_INFO.find((p) => p.id === org.plan)!;
  const deadline = org.lockedAt ? new Date(org.lockedAt.getTime() + LOCK_GRACE_DAYS * 86_400_000) : null;
  const longDate = (d: Date) =>
    d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });

  if (deadline) {
    return (
      <section>
        <h2>Elige un plan para seguir</h2>
        <div className="alert locked-notice" role="alert">
          <p>
            <strong>Tu organización no tiene un plan activo.</strong> Ha terminado la prueba gratuita de 7 días (o se
            creó sin prueba) y el panel está bloqueado hasta que elijas uno de los planes.
          </p>
          <p>
            Tu web y tu carta seguirán visibles hasta el <strong>{longDate(deadline)}</strong>. Si para entonces no has
            elegido al menos el plan Básico, <strong>se eliminarán la organización y todos sus datos</strong> (locales,
            cartas, reservas, clientes, fotos y equipo) y no se podrán recuperar.
          </p>
        </div>
        {isOwner ? (
          <ActionForm
            action={activatePlanAction.bind(null, orgId)}
            submitLabel="Activar el plan"
            resetOnSuccess={false}
            className="form form-wide"
          >
            <fieldset className={styles.plans}>
              <legend className="visually-hidden">Plan de la organización</legend>
              {PLAN_INFO.map((p) => (
                <label key={p.id} className={styles.plan}>
                  <span className={styles.head}>
                    <input type="radio" name="plan" value={p.id} defaultChecked={p.recommended} required />
                    <strong>{p.name}</strong>
                    {p.recommended && <span className="badge badge-ok">Recomendado</span>}
                  </span>
                  <span>
                    <strong>{formatPrice(p.monthlyPrice)}</strong>
                    <span className="muted"> al mes + IVA</span>
                  </span>
                  <span className="muted">{p.summary}</span>
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Todavía no hay cobros configurados: al activar el plan no se cobra nada y el panel se desbloquea al
              momento, con todo lo que tenías.
            </p>
          </ActionForm>
        ) : (
          <p>Solo el propietario de la organización puede elegir el plan. Avísale para que lo active.</p>
        )}
      </section>
    );
  }

  return (
    <section>
      <h2>Plan</h2>
      <p>
        Plan actual: <strong>{current.name}</strong>
        {org.trialEndsAt && <> (prueba gratuita: {trialDaysLeft(org.trialEndsAt)} días restantes)</>}
      </p>
      {org.trialEndsAt && (
        <p>
          Al terminar la prueba tendrás que elegir un plan para seguir usando el panel. Si lo eliges ahora, la prueba
          termina y te quedas en ese plan.
        </p>
      )}
      <p className="notice">
        Todavía no hay cobros configurados: el cambio de plan es inmediato y no se cobra nada (los precios son
        orientativos). Bajar de plan no borra datos: solo deja de mostrar esas secciones, y vuelven al subir de nuevo.
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
              <span>
                <strong>{formatPrice(p.monthlyPrice)}</strong>
                <span className="muted"> al mes + IVA</span>
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
