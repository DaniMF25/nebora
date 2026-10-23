import Link from "next/link";
import { notFound } from "next/navigation";
import { PanelIcon } from "@/components/panel/icons";
import { PanelShell } from "@/components/panel/shell";
import { SidebarNav, type NavGroup } from "@/components/panel/sidebar-nav";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
import { getOrganization, listMyOrganizations } from "@/server/modules/organizations/service";
import { withTenant } from "@/server/tenancy/context";
import { logoutAction } from "../../login/actions";

const ROLE_LABELS = { owner: "Propietario", admin: "Administrador", manager: "Encargado", staff: "Personal" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      org: await getOrganization(tx, ctx),
      role: ctx.role,
      establishments: await listEstablishments(tx, ctx),
      canPrivacy: ctx.permissions.has("privacy.manage"),
      // Solo organizaciones en las que el usuario es miembro activo.
      hasOthers: (await listMyOrganizations(tx, ctx)).some((o) => o.id !== orgId),
    }));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { org, role, establishments, canPrivacy, hasOthers } = data;
  const base = `/app/${orgId}`;

  const groups: NavGroup[] = [
    { title: "", items: [{ href: base, label: "Inicio", icon: "home", exact: true }] },
    {
      title: "Gestión",
      items: [
        { href: `${base}/products`, label: "Productos", icon: "products" },
        { href: `${base}/inventory`, label: "Inventario", icon: "inventory" },
        { href: `${base}/purchasing`, label: "Compras", icon: "purchasing" },
      ],
    },
    ...establishments.map((e) => {
      const est = `${base}/establishments/${e.id}`;
      return {
        title: e.name,
        items: [
          { href: est, label: "Resumen", icon: "store" as const, exact: true },
          { href: `${est}/reservations`, label: "Reservas", icon: "calendar" as const },
          { href: `${est}/floor`, label: "Sala", icon: "floor" as const },
          { href: `${est}/site`, label: "Web pública", icon: "globe" as const },
        ],
      };
    }),
    {
      title: "Organización",
      items: [
        { href: `${base}/members`, label: "Miembros", icon: "team" },
        ...(canPrivacy ? [{ href: `${base}/privacy`, label: "Privacidad", icon: "shield" as const }] : []),
      ],
    },
  ];

  const brand = (
    <Link href={base} className="brand-link">
      <span className="brand-mark" aria-hidden="true">
        {initials(org.name)}
      </span>
      <span>
        <strong>{org.name}</strong>
        <small>Nébora</small>
      </span>
    </Link>
  );

  return (
    <PanelShell
      brand={brand}
      sidebar={
        <>
          <SidebarNav label="Secciones de la organización" groups={groups} />
          <div className="side-footer">
            {hasOthers && (
              <Link href="/app" className="side-switch">
                <PanelIcon name="switch" />
                Cambiar de organización
              </Link>
            )}
            <div className="side-user">
              <span className="avatar" aria-hidden="true">
                {initials(user.displayName)}
              </span>
              <span>
                <strong>{user.displayName}</strong>
                <small>{ROLE_LABELS[role]}</small>
              </span>
              <form action={logoutAction}>
                <button type="submit" className="icon-button" title="Cerrar sesión">
                  <PanelIcon name="logout" />
                  <span className="visually-hidden">Cerrar sesión</span>
                </button>
              </form>
            </div>
          </div>
        </>
      }
    >
      <h1 className="panel-org">{org.name}</h1>
      {children}
    </PanelShell>
  );
}
