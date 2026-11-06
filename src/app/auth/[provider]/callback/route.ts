import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/current-user";
import { takeAttempt } from "@/server/auth/oauth/attempt";
import { enabledProviders, exchangeCode, isOAuthProvider, OAuthError } from "@/server/auth/oauth/providers";
import { sameState, signInWithIdentity, SocialLoginError, type SocialLoginErrorCode } from "@/server/auth/oauth/service";
import { getEnv } from "@/server/config/env";
import { clientIdentifier } from "@/server/request-ip";

function back(path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, getEnv().APP_BASE_URL), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
const fail = (code: SocialLoginErrorCode) => back(`/login?error=${code}`);

/**
 * Vuelta del proveedor (D-061): comprueba que el intento es de este navegador
 * (state), canjea el código en el servidor, comprueba la identidad y abre la
 * sesión. Google y Facebook vuelven con GET; Apple, con un POST de formulario.
 */
async function handle(provider: string, params: URLSearchParams): Promise<NextResponse> {
  if (!isOAuthProvider(provider) || !enabledProviders().includes(provider)) {
    return new NextResponse("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const attempt = await takeAttempt();
  if (!attempt || attempt.provider !== provider || !sameState(params.get("state"), attempt.state)) {
    return fail("invalid_state");
  }
  if (params.get("error")) return fail("cancelled");
  const code = params.get("code");
  if (!code || code.length > 2048) return fail("provider_error");
  try {
    const profile = await exchangeCode(provider, code, attempt, { appleUser: params.get("user") });
    const { session } = await signInWithIdentity(profile, { clientId: await clientIdentifier() });
    await setSessionCookie(session);
  } catch (err) {
    if (err instanceof SocialLoginError) return fail(err.code);
    if (err instanceof OAuthError) return fail(err.code === "missing_email" ? "missing_email" : "provider_error");
    throw err;
  }
  return back(attempt.next);
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return handle((await params).provider, new URL(request.url).searchParams);
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const form = await request.formData();
  const fields = new URLSearchParams();
  for (const key of ["state", "code", "error", "user"]) {
    const v = form.get(key);
    if (typeof v === "string") fields.set(key, v);
  }
  return handle((await params).provider, fields);
}
