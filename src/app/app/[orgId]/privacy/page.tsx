import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PrivacyLookup } from "@/components/privacy-lookup";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getPrivacySettings } from "@/server/modules/privacy/service";
import { withTenant } from "@/server/tenancy/context";
import { applyRetentionAction, eraseCustomerAction, searchCustomerAction, updatePrivacySettingsAction } from "./actions";

export default async function PrivacyPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let settings;
  try {
    settings = await withTenant(user, orgId, (tx, ctx) => getPrivacySettings(tx, ctx));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  return (
    <>
      <h2>Privacidad de clientes</h2>
      <p className="muted">
        Herramientas para gestionar los datos personales de clientes (nombre, teléfono, correo y comentarios de las
        reservas). No sustituyen el asesoramiento sobre protección de datos.
      </p>

      <section>
        <h3>Plazo de conservación</h3>
        <p>
          Los datos personales se anonimizan <strong>{settings.customerRetentionDays} días</strong> después de cada reserva.
          Se conservan la fecha, los comensales y las mesas para estadísticas.
        </p>
        <ActionForm action={updatePrivacySettingsAction.bind(null, orgId)} submitLabel="Guardar plazo" className="inline-form">
          <label>
            Días de conservación
            <input
              type="number"
              name="customerRetentionDays"
              min={30}
              max={3650}
              defaultValue={settings.customerRetentionDays}
            />
          </label>
        </ActionForm>
        <ActionForm action={applyRetentionAction.bind(null, orgId)} submitLabel="Aplicar ahora" className="inline-form" />
        <p className="muted">
          La anonimización automática requiere programar a diario <code>pnpm privacy:retention</code> en el servidor.
          Mientras no esté programada, se aplica al pulsar «Aplicar ahora».
        </p>
      </section>

      <section>
        <h3>Solicitudes de clientes (acceso y borrado)</h3>
        <p className="muted">
          Busca por el correo o teléfono con el que reservó. Puedes entregarle una copia de sus datos o borrarlos
          (anonimizar). Las reservas futuras activas deben cancelarse antes de borrar.
        </p>
        <PrivacyLookup
          searchAction={searchCustomerAction.bind(null, orgId)}
          eraseAction={eraseCustomerAction.bind(null, orgId)}
          exportUrl={`/app/${orgId}/privacy/export`}
        />
      </section>
    </>
  );
}
