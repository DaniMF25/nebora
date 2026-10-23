import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { listMyOrganizations } from "@/server/modules/organizations/service";
import { withUser } from "@/server/tenancy/context";
import { logoutAction } from "../login/actions";
import { createOrganizationAction } from "./actions";

const ROLE_LABELS = { owner: "Propietario", admin: "Administrador", manager: "Encargado", staff: "Personal" };

export default async function OrganizationsPage() {
  const user = await requireUser();
  const orgs = await withUser(user, (tx, ctx) => listMyOrganizations(tx, ctx));
  return (
    <main className="panel-single">
      <header className="single-top">
        <strong className="wordmark">Nébora</strong>
        <form action={logoutAction} className="inline-form">
          <span className="muted">{user.displayName}</span>
          <button type="submit" className="secondary">
            Cerrar sesión
          </button>
        </form>
      </header>
      <h1>Tus organizaciones</h1>
      {orgs.length === 0 ? (
        <p className="muted">Todavía no perteneces a ninguna organización. Crea la primera.</p>
      ) : (
        <ul className="cards">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/app/${o.id}`}>{o.name}</Link>{" "}
              <span className="muted">· {ROLE_LABELS[o.role]}</span>
            </li>
          ))}
        </ul>
      )}
      <section>
        <h2>Nueva organización</h2>
        <ActionForm action={createOrganizationAction} submitLabel="Crear organización">
          <label>
            Nombre
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Identificador (URL)
            <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" placeholder="mi-restaurante" />
          </label>
        </ActionForm>
      </section>
    </main>
  );
}
