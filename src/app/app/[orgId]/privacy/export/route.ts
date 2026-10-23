import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { exportCustomerData } from "@/server/modules/privacy/service";
import { withTenant } from "@/server/tenancy/context";

function text(status: number, body: string) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Exportación de los datos de un cliente. POST (el contacto no viaja en la
 * URL) y con comprobación de origen, ya que los Route Handlers no tienen la
 * protección CSRF automática de las Server Actions.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return text(403, "Origen no permitido");
  const { orgId } = await params;
  const user = await getCurrentUser();
  if (!user) return text(401, "No autenticado");
  const contact = (await request.formData()).get("contact");
  try {
    const data = await withTenant(user, orgId, (tx, ctx) => exportCustomerData(tx, ctx, contact));
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="datos-cliente-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return text(404, "No encontrado");
    if (err instanceof AppError) return text(400, err.message);
    throw err;
  }
}
