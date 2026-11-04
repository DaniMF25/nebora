import { NextResponse } from "next/server";
import { formToObject } from "@/server/actions/form-state";
import { getCurrentUser } from "@/server/auth/current-user";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { exportCsv, isExportKind } from "@/server/modules/exports/service";
import { isSameOrigin } from "@/server/same-origin";
import { withTenant } from "@/server/tenancy/context";

function text(status: number, body: string) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Descarga de una exportación CSV (D-058). POST con comprobación de origen
 * (los Route Handlers no tienen la protección CSRF de las Server Actions);
 * permisos, plan y locales los comprueba el servicio y RLS.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string; kind: string }> }) {
  if (!isSameOrigin(request.headers)) return text(403, "Origen no permitido");
  const { orgId, kind } = await params;
  if (!isExportKind(kind)) return text(404, "No encontrado");
  const user = await getCurrentUser();
  if (!user) return text(401, "No autenticado");
  const input = formToObject(await request.formData(), ["establishmentId", "from", "to"]);
  try {
    const file = await withTenant(user, orgId, (tx, ctx) => exportCsv(tx, ctx, kind, input));
    return new NextResponse(file.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return text(404, "No encontrado");
    if (err instanceof AppError) return text(400, err.message);
    throw err;
  }
}
