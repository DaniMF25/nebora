import { NextResponse } from "next/server";
import { resolveMenuCode } from "@/server/modules/menus/menus";

/**
 * Enlace corto permanente de una carta (destino de los QR). Redirección
 * temporal (307) para que un cambio de identificador se refleje siempre.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const path = await resolveMenuCode(code);
  if (!path) {
    return new NextResponse("Carta no disponible", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const response = NextResponse.redirect(new URL(path, request.url), 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
