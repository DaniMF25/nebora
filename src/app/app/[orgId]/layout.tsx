import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgNav } from "@/components/org-nav";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { getOrganization, listMyOrganizations } from "@/server/modules/organizations/service";
import { withTenant } from "@/server/tenancy/context";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  let org;
  let canPrivacy: boolean;
  let others: { id: string; name: string }[];
  try {
    ({ org, canPrivacy, others } = await withTenant(user, orgId, async (tx, ctx) => ({
      org: await getOrganization(tx, ctx),
      canPrivacy: ctx.permissions.has("privacy.manage"),
      // Solo organizaciones en las que el usuario es miembro activo.
      others: (await listMyOrganizations(tx, ctx)).filter((o) => o.id !== orgId),
    })));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <>
      <div className="org-bar">
        <h1>{org.name}</h1>
        {others.length > 0 && (
          <details className="org-switcher">
            <summary>Cambiar de organización</summary>
            <ul>
              {others.map((o) => (
                <li key={o.id}>
                  <Link href={`/app/${o.id}`}>{o.name}</Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <OrgNav
        items={[
          { href: `/app/${orgId}`, label: "Inicio" },
          { href: `/app/${orgId}/products`, label: "Productos" },
          { href: `/app/${orgId}/inventory`, label: "Inventario" },
          { href: `/app/${orgId}/purchasing`, label: "Compras" },
          { href: `/app/${orgId}/members`, label: "Miembros" },
          ...(canPrivacy ? [{ href: `/app/${orgId}/privacy`, label: "Privacidad" }] : []),
        ]}
      />
      {children}
    </>
  );
}
