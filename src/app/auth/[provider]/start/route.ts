import { NextResponse } from "next/server";
import { startAttempt } from "@/server/auth/oauth/attempt";
import { authorizationUrl, enabledProviders, isOAuthProvider } from "@/server/auth/oauth/providers";

/** Empieza el inicio de sesión con un proveedor configurado: guarda el intento y envía a su página (D-061). */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isOAuthProvider(provider) || !enabledProviders().includes(provider)) {
    return new NextResponse("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const attempt = await startAttempt(provider, new URL(request.url).searchParams.get("next"));
  const res = NextResponse.redirect(await authorizationUrl(provider, attempt), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
