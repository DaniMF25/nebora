import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { getOrganization } from "@/server/modules/organizations/service";
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
  try {
    ({ org, canPrivacy } = await withTenant(user, orgId, async (tx, ctx) => ({
      org: await getOrganization(tx, ctx),
      canPrivacy: ctx.permissions.has("privacy.manage"),
    })));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <>
      <h1>{org.name}</h1>
      <nav className="sub" aria-label="Secciones de la organización">
        <Link href={`/app/${orgId}`}>Establecimientos</Link>
        <Link href={`/app/${orgId}/products`}>Productos</Link>
        <Link href={`/app/${orgId}/inventory`}>Inventario</Link>
        <Link href={`/app/${orgId}/purchasing`}>Compras</Link>
        <Link href={`/app/${orgId}/members`}>Miembros</Link>
        {canPrivacy && <Link href={`/app/${orgId}/privacy`}>Privacidad</Link>}
      </nav>
      {children}
    </>
  );
}
