import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getMenuSummary } from "@/server/modules/menus/menus";
import { menuShortUrl, renderQrPng, renderQrSvg } from "@/server/modules/menus/qr";
import { withTenant } from "@/server/tenancy/context";

function text(status: number, body: string) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** QR de la carta en SVG o PNG. Solo para miembros con permiso de lectura de cartas. */
export async function GET(request: Request, { params }: { params: Promise<{ orgId: string; menuId: string }> }) {
  const { orgId, menuId } = await params;
  const user = await getCurrentUser();
  if (!user) return text(401, "No autenticado");

  let menu;
  try {
    menu = await withTenant(user, orgId, (tx, ctx) => getMenuSummary(tx, ctx, menuId));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return text(404, "No encontrado");
    throw err;
  }

  const baseUrl = getEnv().APP_BASE_URL;
  if (!baseUrl) return text(503, "QR no disponible: APP_BASE_URL no está configurada");

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "png" ? "png" : "svg";
  const download = url.searchParams.get("download") === "1";
  const shortUrl = menuShortUrl(baseUrl, menu.publicCode);
  const filename = `qr-${menu.slug}.${format}`;
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // El SVG se sirve desde nuestro origen: sin scripts ni recursos externos.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${filename}"`;

  if (format === "png") {
    const png = await renderQrPng(shortUrl);
    return new NextResponse(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
  const svg = await renderQrSvg(shortUrl);
  return new NextResponse(svg, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
}
