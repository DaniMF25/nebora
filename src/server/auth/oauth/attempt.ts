import "server-only";
import { cookies } from "next/headers";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getEnv } from "@/server/config/env";
import { generateToken } from "../tokens";
import { isOAuthProvider, type AuthorizationRequest, type OAuthProvider } from "./providers";

/**
 * Intento de inicio de sesión con un proveedor, guardado en una cookie
 * HttpOnly de 10 minutos hasta la vuelta (D-061). Su `state` es la protección
 * contra CSRF: solo el navegador que empezó el intento puede terminarlo.
 */
export interface OAuthAttempt extends AuthorizationRequest {
  provider: OAuthProvider;
  next: string;
  expiresAt: number;
}

const TTL_SECONDS = 600;

// En producción con el prefijo __Host- (exige Secure, Path=/ y sin Domain).
function cookieName(): string {
  return getEnv().NODE_ENV === "production" ? "__Host-nebora_oauth" : "nebora_oauth";
}

export async function startAttempt(provider: OAuthProvider, next: unknown): Promise<OAuthAttempt> {
  const attempt: OAuthAttempt = {
    provider,
    state: generateToken(),
    codeVerifier: generateToken(),
    nonce: generateToken(),
    next: safeRedirectPath(next),
    expiresAt: Date.now() + TTL_SECONDS * 1000,
  };
  (await cookies()).set(cookieName(), Buffer.from(JSON.stringify(attempt)).toString("base64url"), {
    httpOnly: true,
    // Apple vuelve con un POST desde su dominio: la cookie solo viaja con SameSite=None (y Secure).
    sameSite: provider === "apple" ? "none" : "lax",
    secure: provider === "apple" || getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return attempt;
}

/** Lee y borra el intento: cada uno sirve una sola vez. */
export async function takeAttempt(): Promise<OAuthAttempt | null> {
  const jar = await cookies();
  const raw = jar.get(cookieName())?.value;
  jar.delete(cookieName());
  if (!raw || raw.length > 2000) return null;
  try {
    const a = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthAttempt>;
    if (
      !isOAuthProvider(a.provider) ||
      typeof a.state !== "string" ||
      typeof a.codeVerifier !== "string" ||
      typeof a.nonce !== "string" ||
      typeof a.expiresAt !== "number" ||
      a.expiresAt < Date.now()
    ) {
      return null;
    }
    return { ...(a as OAuthAttempt), next: safeRedirectPath(a.next) };
  } catch {
    return null;
  }
}
