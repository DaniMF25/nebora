import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
import { listMembers } from "@/server/modules/members/service";
import { listStaffMembers, type StaffMember } from "@/server/modules/staff/service";
import { withTenant } from "@/server/tenancy/context";
import { createStaffMemberAction, deleteStaffMemberAction, updateStaffMemberAction } from "./actions";
import { SectionSwitch } from "@/components/panel/section-switch";
import { staffLinks } from "../sections";

/** Campos de una ficha. Las cuentas que se ofrecen son las de miembros sin ficha (o la suya). */
function MemberFields({
  m,
  accounts,
  idPrefix,
}: {
  m?: StaffMember;
  accounts: { userId: string; displayName: string }[];
  idPrefix: string;
}) {
  return (
    <>
      <div className="inline-form">
        <label>
          Nombre
          <input name="name" required maxLength={80} defaultValue={m?.name} autoComplete="off" />
        </label>
        <label>
          Puesto (opcional)
          <input
            name="position"
            maxLength={40}
            defaultValue={m?.position ?? ""}
            placeholder="Sala, cocina, barra…"
            list={`${idPrefix}-positions`}
          />
        </label>
      </div>
      <datalist id={`${idPrefix}-positions`}>
        {["Sala", "Cocina", "Barra", "Office", "Encargado"].map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {accounts.length > 0 && (
        <label>
          Cuenta en Nébora (opcional)
          <select name="userId" defaultValue={m?.userId ?? ""}>
            <option value="">Sin cuenta</option>
            {accounts.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export default async function StaffPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canManage = ctx.permissions.has("staff.manage");
      return {
        canManage,
        staff: await listStaffMembers(tx, ctx, { includeInactive: true }),
        // Para vincular una ficha a la cuenta de un miembro activo.
        members:
          canManage && ctx.permissions.has("members.read")
            ? (await listMembers(tx, ctx)).filter((m) => m.status === "active")
            : [],
        establishments: await listEstablishments(tx, ctx),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { canManage, staff, members, establishments } = data;
  const linked = new Set(staff.map((s) => s.userId).filter(Boolean));
  const accountsFor = (m?: StaffMember) => {
    const options = members
      .filter((a) => !linked.has(a.userId) || a.userId === m?.userId)
      .map(({ userId, displayName }) => ({ userId, displayName }));
    // Su cuenta actual aunque el miembro esté suspendido, para no desvincularla sin querer.
    if (m?.userId && !options.some((o) => o.userId === m.userId)) {
      options.push({ userId: m.userId, displayName: m.userName ?? "Cuenta vinculada" });
    }
    return options;
  };

  return (
    <>
      <section>
        <h2>Turnos y horarios</h2>
        <SectionSwitch
          label="Apartados de turnos y horarios"
          links={staffLinks(
            orgId,
            establishments.map((e) => ({ id: e.id, name: e.name })),
            "people",
          )}
        />
        <h3>Personal</h3>
        <p className="muted">
          Fichas del personal de todos los locales para el cuadrante de turnos. No hace falta que tengan cuenta en
          Nébora; si la persona es miembro, vincula su cuenta para que vea sus turnos destacados. Solo se guarda el
          nombre y el puesto.
        </p>
        {staff.length === 0 ? (
          <p className="muted">Todavía no hay nadie en el personal.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Puesto</th>
                  <th>Cuenta</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => (
                  <tr key={m.id} className={m.active ? undefined : "status-cancelled"}>
                    <td data-label="Nombre">{m.name}</td>
                    <td data-label="Puesto">{m.position ?? <span className="muted">—</span>}</td>
                    <td data-label="Cuenta">{m.userName ?? <span className="muted">Sin cuenta</span>}</td>
                    <td data-label="Estado">{m.active ? "Activo" : "Desactivado"}</td>
                    {canManage && (
                      <td data-label="Acciones">
                        <details>
                          <summary>Editar a {m.name}</summary>
                          <ActionForm
                            action={updateStaffMemberAction.bind(null, orgId, m.id)}
                            submitLabel="Guardar cambios"
                            resetOnSuccess={false}
                            secondary={{
                              action: deleteStaffMemberAction.bind(null, orgId, m.id),
                              label: `Eliminar a ${m.name}`,
                            }}
                          >
                            <MemberFields m={m} accounts={accountsFor(m)} idPrefix={m.id} />
                            <label className="check">
                              <input type="checkbox" name="active" defaultChecked={m.active} />
                              <span>Activo (desactiva a quien ya no trabaja: conserva sus turnos pasados)</span>
                            </label>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section>
          <h3>Añadir persona</h3>
          <ActionForm
            action={createStaffMemberAction.bind(null, orgId)}
            submitLabel="Añadir persona"
            className="form form-wide"
          >
            <MemberFields accounts={accountsFor()} idPrefix="new" />
          </ActionForm>
        </section>
      )}
    </>
  );
}
