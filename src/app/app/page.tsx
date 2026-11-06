import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { TRIAL_DAYS } from "@/lib/plans";
import {
  canStartTrial,
  countAccessibleEstablishments,
  listMyOrganizations,
} from "@/server/modules/organizations/service";
import { withTenant, withUser } from "@/server/tenancy/context";
import type { Plan } from "@/server/tenancy/permissions";
import { logoutAction } from "../login/actions";
import { createOrganizationAction } from "./actions";

const ROLE_LABELS = { owner: "Propietario", admin: "Administrador", manager: "Encargado", staff: "Personal" };
const PLAN_LABELS: Record<Plan, string> = { basic: "Básico", advanced: "Avanzado", pro: "PRO" };

/**
 * Entrada al panel (D-055):
 * - con una sola organización se entra directamente en ella;
 * - sin ninguna, una bienvenida con los primeros pasos y el alta del negocio;
 * - con varias (o al venir de «Cambiar de organización»), el selector.
 */
export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ elegir?: string | string[] }>;
}) {
  const user = await requireUser();
  const { orgs, trial } = await withUser(user, async (tx, ctx) => ({
    orgs: await listMyOrganizations(tx, ctx),
    trial: await canStartTrial(tx, ctx),
  }));
  const choosing = (await searchParams).elegir !== undefined;
  if (orgs.length === 1 && !choosing) redirect(orgs[0]!.lockedAt ? `/app/${orgs[0]!.id}/plan` : `/app/${orgs[0]!.id}`);

  const header = (
    <header className="single-top">
      <strong className="wordmark">Nébora</strong>
      <form action={logoutAction} className="inline-form">
        <span className="muted">{user.displayName}</span>
        <button type="submit" className="secondary">
          Cerrar sesión
        </button>
      </form>
    </header>
  );

  if (orgs.length === 0) {
    return (
      <main className="panel-single onboarding">
        {header}
        <p className="onboarding-eyebrow">Hola, {user.displayName.split(" ")[0]}</p>
        <h1>Pon en marcha tu restaurante</h1>
        <p className="onboarding-lead">
          En unos minutos tendrás tu carta digital con código QR y la web de tu local, listas para compartir.
        </p>
        {trial && (
          <p className="notice">
            <span>
              <strong>{TRIAL_DAYS} días gratis del plan PRO</strong>: reservas, equipo, inventario y compras incluidos,
              sin tarjeta. Al terminar eliges plan y sigues con todo lo que hayas montado.
            </span>
          </p>
        )}
        <ol className="onboarding-steps">
          <li className="is-current">
            <strong>Tu negocio</strong>
            <span>El nombre con el que te conocen. Si tienes varios locales, irán todos dentro.</span>
          </li>
          <li>
            <strong>Tu primer local</strong>
            <span>Dirección, horario y, si quieres, las mesas para las reservas.</span>
          </li>
          <li>
            <strong>Tu carta y tu web</strong>
            <span>Añade los platos, elige un estilo, publica y comparte el QR.</span>
          </li>
        </ol>
        <section className="onboarding-card" aria-labelledby="alta-negocio">
          <h2 id="alta-negocio">¿Cómo se llama tu negocio?</h2>
          <CreateOrganizationForm />
        </section>
        <p className="muted onboarding-note">
          ¿Te han invitado al equipo de un restaurante? No hace falta crear nada: abre el enlace de la invitación que te
          enviaron.
        </p>
      </main>
    );
  }

  // Locales de cada organización (a los que accede la cuenta), para reconocerlas de un vistazo.
  const establishments = await Promise.all(
    orgs.map((o) => withTenant(user, o.id, (tx, ctx) => countAccessibleEstablishments(tx, ctx)).catch(() => null)),
  );
  return (
    <main className="panel-single">
      {header}
      <h1>Elige una organización</h1>
      <p className="muted">Cada organización tiene sus propios locales, cartas, equipo y plan.</p>
      <ul className="org-picker">
        {orgs.map((o, i) => {
          const n = establishments[i];
          return (
            <li key={o.id}>
              <Link href={o.lockedAt ? `/app/${o.id}/plan` : `/app/${o.id}`} className="org-card">
                <span className="org-avatar" aria-hidden="true">
                  {o.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="org-card-body">
                  <strong>{o.name}</strong>
                  <span className="muted">
                    {ROLE_LABELS[o.role]}
                    {n !== null && ` · ${n === 1 ? "1 local" : `${n} locales`}`}
                  </span>
                </span>
                <span className={o.lockedAt ? "badge badge-warn" : "badge"}>
                  {o.lockedAt ? "Sin plan" : o.trialEndsAt ? "Prueba PRO" : PLAN_LABELS[o.plan]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <details className="org-new" open={orgs.length === 1}>
        <summary>Crear otra organización</summary>
        <p className="muted">
          Para otro negocio con su propio equipo y plan. Si solo abres un local nuevo, añádelo dentro de tu organización.
        </p>
        <CreateOrganizationForm />
      </details>
    </main>
  );
}

function CreateOrganizationForm() {
  return (
    <ActionForm action={createOrganizationAction} submitLabel="Crear organización">
      <label>
        Nombre del negocio
        <input name="name" required maxLength={120} placeholder="Casa Pepe" autoComplete="organization" />
      </label>
      <label>
        Identificador (URL), opcional
        <input
          name="slug"
          pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"
          placeholder="casa-pepe"
          aria-describedby="slug-ayuda"
        />
      </label>
      <p id="slug-ayuda" className="muted field-hint">
        Aparece en la dirección de tu web. Si lo dejas vacío, se crea a partir del nombre.
      </p>
    </ActionForm>
  );
}
