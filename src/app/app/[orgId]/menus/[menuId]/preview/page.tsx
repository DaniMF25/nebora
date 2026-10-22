import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuView } from "@/components/menu-view";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { buildSnapshot } from "@/server/modules/menus/menus";
import { requirePermission, withTenant } from "@/server/tenancy/context";

/** Vista previa del borrador: solo para miembros con permiso de lectura de cartas. */
export default async function MenuPreviewPage({ params }: { params: Promise<{ orgId: string; menuId: string }> }) {
  const { orgId, menuId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      requirePermission(ctx, "menus.read");
      return { snapshot: await buildSnapshot(tx, ctx, menuId) };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  return (
    <>
      <p role="status" className="notice">
        Vista previa del borrador (no es pública). <Link href={`/app/${orgId}/menus/${menuId}`}>Volver al editor</Link>
      </p>
      <MenuView snapshot={data.snapshot} />
    </>
  );
}
