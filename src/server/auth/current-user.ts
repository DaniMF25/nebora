import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getEnv } from "@/server/config/env";
import { revokeSession, validateSessionToken, type AuthUser, type SessionInfo } from "./service";

// En producción se usa el prefijo __Host- (exige Secure, Path=/ y sin Domain).
export function sessionCookieName(): string {
  return getEnv().NODE_ENV === "production" ? "__Host-nebora_session" : "nebora_session";
}

/** Usuario autenticado de la petición actual, validado contra la base de datos. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const result = await validateSessionToken(token);
  return result?.user ?? null;
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Solo puede llamarse desde Server Actions o Route Handlers. Si el navegador ya
 * tenía otra sesión (p. ej. desde otra pestaña), se revoca: la cookie
 * sustituida no debe seguir siendo válida en el servidor (D-044).
 */
export async function setSessionCookie(session: SessionInfo): Promise<void> {
  const jar = await cookies();
  const previous = jar.get(sessionCookieName())?.value;
  if (previous && previous !== session.token) await revokeSession(previous);
  jar.set(sessionCookieName(), session.token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName())?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(sessionCookieName());
}
