import { NextResponse } from "next/server";
import { getPublicMedia } from "@/server/modules/media/service";

/**
 * Imagen pública. Solo se sirve si la usa contenido publicado (perfil del local
 * o carta publicada); en cualquier otro caso responde 404 sin distinguir si existe.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await getPublicMedia(id);
  if (!file) {
    return new NextResponse("No encontrado", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const headers = {
    "Content-Type": file.contentType,
    ETag: file.etag,
    // Corto: si se despublica el contenido, la imagen deja de servirse pronto.
    "Cache-Control": "public, max-age=300",
    "Content-Security-Policy": "default-src 'none'",
  };
  if (request.headers.get("if-none-match") === file.etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(file.data), { headers });
}
