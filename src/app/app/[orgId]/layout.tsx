import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PanelIcon } from "@/components/panel/icons";
import { PanelShell } from "@/components/panel/shell";
import { SidebarNav, type LocalNav, type NavGroup } from "@/components/panel/sidebar-nav";
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
      can: {
        privacy: ctx.permissions.has("privacy.manage"),
        stats: ctx.permissions.has("stats.read"),
        menus: ctx.permissions.has("menus.read"),
        inventory: ctx.permissions.has("inventory.read"),
        purchasing: ctx.permissions.has("purchasing.read"),
      },
      // Solo organizaciones en las que el usuario es miembro activo.
      hasOthers: (await listMyOrganizations(tx, ctx)).some((o) => o.id !== orgId),
    }));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { org, role, establishments, can, hasOthers } = data;
  const base = `/app/${orgId}`;

  // Catálogo común (productos, ingredientes, proveedores), operativa de cada
  // local (selector si hay varios) y, con varios locales, vistas del grupo.
  const groups: NavGroup[] = [
    { title: "", items: [{ href: base, label: "Inicio", icon: "home", exact: true }] },
    {
      title: "Catálogo",
      items: [
        { href: `${base}/products`, label: "Productos", icon: "products" },
        ...(can.inventory ? [{ href: `${base}/ingredients`, label: "Ingredientes", icon: "inventory" as const }] : []),
        ...(can.purchasing ? [{ href: `${base}/suppliers`, label: "Proveedores", icon: "team" as const }] : []),
      ],
    },
    ...(establishments.length > 1 && (can.inventory || can.purchasing)
      ? [
          {
            title: "Todo el grupo",
            items: [
              ...(can.inventory ? [{ href: `${base}/inventory`, label: "Inventario del grupo", icon: "inventory" as const }] : []),
              ...(can.purchasing ? [{ href: `${base}/purchasing`, label: "Compras del grupo", icon: "purchasing" as const }] : []),
            ],
          },
        ]
      : []),
    {
      title: "Organización",
      items: [
        { href: `${base}/members`, label: "Miembros", icon: "team" },
        ...(can.privacy ? [{ href: `${base}/privacy`, label: "Privacidad", icon: "shield" as const }] : []),
      ],
    },
  ];
  const lastLocal = (await cookies()).get("nebora_last_est")?.value ?? null;
  const local: LocalNav | null =
    establishments.length === 0
      ? null
      : {
          base,
          establishments: establishments.map((e) => ({ id: e.id, name: e.name })),
          initialId: establishments.some((e) => e.id === lastLocal) ? lastLocal : null,
          items: [
            { path: "", label: "Resumen", icon: "store", exact: true },
            ...(can.menus ? [{ path: "/menus", label: "Cartas", icon: "products" as const }] : []),
            { path: "/reservations", label: "Reservas", icon: "calendar" },
            { path: "/floor", label: "Sala", icon: "floor" },
            ...(can.inventory ? [{ path: "/inventory", label: "Inventario", icon: "inventory" as const }] : []),
            ...(can.purchasing ? [{ path: "/purchasing", label: "Compras", icon: "purchasing" as const }] : []),
            { path: "/site", label: "Web pública", icon: "globe" },
            ...(can.stats ? [{ path: "/stats", label: "Estadísticas", icon: "summary" as const }] : []),
          ],
        };

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
          <SidebarNav label="Secciones de la organización" groups={groups} local={local} localAfter={1} />
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
