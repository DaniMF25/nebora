import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { getOrganizationMedia } from "@/server/modules/media/service";
import { withTenant } from "@/server/tenancy/context";

function notFound() {
  return new NextResponse("No encontrado", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Imagen de la organización para el panel (también las no publicadas). Solo miembros. */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string; id: string }> }) {
  const { orgId, id } = await params;
  const user = await getCurrentUser();
  if (!user) return notFound();
  try {
    const file = await withTenant(user, orgId, (tx, ctx) => getOrganizationMedia(tx, ctx, id));
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return notFound();
    throw err;
  }
}
