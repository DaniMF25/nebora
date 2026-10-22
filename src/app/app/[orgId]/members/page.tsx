import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { InviteForm } from "@/components/invite-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listMembers, listOpenInvitations } from "@/server/modules/members/service";
import { withTenant } from "@/server/tenancy/context";
import { ROLES, type Role } from "@/server/tenancy/permissions";
import {
  changeRoleAction,
  createInvitationAction,
  removeMemberAction,
  revokeInvitationAction,
} from "./actions";

const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  staff: "Personal",
};

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canManage = ctx.permissions.has("members.manage");
      return {
        actorRole: ctx.role,
        canManage,
        members: await listMembers(tx, ctx),
        invitations: canManage ? await listOpenInvitations(tx, ctx) : [],
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  // Opciones de rol que se ofrecen en la interfaz; el servidor aplica las reglas reales.
  const assignable = ROLES.filter((r) => r !== "owner" || data.actorRole === "owner");

  return (
    <>
      <section>
        <h2>Miembros</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                {data.canManage && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const editable =
                  data.canManage && m.userId !== user.id && (m.role !== "owner" || data.actorRole === "owner");
                return (
                  <tr key={m.membershipId}>
                    <td>
                      {m.displayName}
                      {m.status === "suspended" && <span className="muted"> (suspendido)</span>}
                    </td>
                    <td>{m.email}</td>
                    <td>{ROLE_LABELS[m.role]}</td>
                    {data.canManage && (
                      <td>
                        {editable ? (
                          <>
                            <ActionForm
                              action={changeRoleAction.bind(null, orgId, m.membershipId)}
                              submitLabel="Cambiar rol"
                              className="inline-form"
                            >
                              <label>
                                <span className="visually-hidden">Rol de {m.displayName}</span>
                                <select name="role" defaultValue={m.role}>
                                  {assignable.map((r) => (
                                    <option key={r} value={r}>
                                      {ROLE_LABELS[r]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </ActionForm>
                            <ActionForm
                              action={removeMemberAction.bind(null, orgId, m.membershipId)}
                              submitLabel={`Quitar a ${m.displayName}`}
                              className="inline-form"
                            />
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {data.canManage && (
        <>
          <section>
            <h2>Invitar</h2>
            <p className="muted">
              El correo no está configurado: se generará un enlace de un solo uso que debes entregar tú. Solo
              funciona para la dirección indicada.
            </p>
            <InviteForm action={createInvitationAction.bind(null, orgId)} />
          </section>
          <section>
            <h2>Invitaciones abiertas</h2>
            {data.invitations.length === 0 ? (
              <p className="muted">No hay invitaciones abiertas.</p>
            ) : (
              <ul className="cards">
                {data.invitations.map((i) => (
                  <li key={i.id}>
                    {i.email} · {ROLE_LABELS[i.role]} ·{" "}
                    {i.status === "expired" ? "caducada" : `caduca el ${dateFormat.format(i.expiresAt)}`}
                    <ActionForm
                      action={revokeInvitationAction.bind(null, orgId, i.id)}
                      submitLabel="Revocar"
                      className="inline-form"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
