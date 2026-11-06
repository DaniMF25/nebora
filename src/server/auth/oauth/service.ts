import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { isUniqueViolation, withTransaction } from "@/server/db/pool";
import { fingerprint, hitRateLimit } from "@/server/rate-limit";
import { createSession, type AuthUser, type ClientOptions, type SessionInfo } from "../service";
import type { ProviderProfile } from "./providers";

/** Por qué no se pudo entrar con el proveedor (se muestra en la página de acceso). */
export type SocialLoginErrorCode =
  | "signup_disabled"
  | "email_in_use"
  | "missing_email"
  | "account_disabled"
  | "provider_error"
  | "invalid_state"
  | "cancelled"
  | "rate_limited";

export class SocialLoginError extends Error {
  constructor(public readonly code: SocialLoginErrorCode) {
    super(code);
  }
}

export const SOCIAL_LOGIN_MESSAGES: Record<SocialLoginErrorCode, string> = {
  signup_disabled:
    "No hay ninguna cuenta con ese correo y el registro no está habilitado. Si te han invitado, abre el enlace de la invitación.",
  email_in_use:
    "Ya hay una cuenta con ese correo. Entra con tu correo y contraseña: por seguridad no la vinculamos con este proveedor.",
  missing_email: "El proveedor no nos ha dado tu correo. Permite compartirlo o entra con tu correo y contraseña.",
  account_disabled: "Esta cuenta está desactivada.",
  provider_error: "No se pudo completar el inicio de sesión con el proveedor. Inténtalo de nuevo.",
  invalid_state: "El inicio de sesión ha caducado o no es válido. Vuelve a intentarlo.",
  cancelled: "Se canceló el inicio de sesión.",
  rate_limited: "Demasiados intentos. Espera unos minutos.",
};

export function isSocialLoginErrorCode(value: unknown): value is SocialLoginErrorCode {
  return typeof value === "string" && value in SOCIAL_LOGIN_MESSAGES;
}

export const SOCIAL_LOGIN_MAX_PER_IP = 30;

/** Compara el `state` de vuelta con el guardado sin revelar diferencias por tiempo. */
export function sameState(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function displayNameFor(profile: ProviderProfile): string {
  const name = profile.name?.trim().slice(0, 120);
  if (name) return name;
  const local = profile.email?.split("@")[0]?.slice(0, 120);
  return local || "Usuario";
}

/**
 * Entra (o se da de alta) con una identidad ya comprobada por el proveedor (D-061):
 * 1. Si la identidad está vinculada, entra en esa cuenta.
 * 2. Si no, y el proveedor garantiza el correo (Google, Apple), se vincula a la
 *    cuenta con ese correo si existe.
 * 3. Si el correo existe pero el proveedor no lo garantiza (Facebook), no se
 *    vincula: podría ser la cuenta de otra persona.
 * 4. Si no hay cuenta, se crea sin contraseña, solo si el registro está habilitado.
 */
export async function signInWithIdentity(
  profile: ProviderProfile,
  options: { allowSignup?: boolean } & ClientOptions = {},
): Promise<{ user: AuthUser; session: SessionInfo; created: boolean }> {
  if (
    options.clientId !== undefined &&
    !(await hitRateLimit(`social-ip:${fingerprint(options.clientId)}`, 15 * 60, SOCIAL_LOGIN_MAX_PER_IP))
  ) {
    throw new SocialLoginError("rate_limited");
  }
  const allowSignup = options.allowSignup ?? getEnv().AUTH_ALLOW_SIGNUP === "true";

  const resolve = () =>
    withTransaction(async (tx) => {
      const linked = await tx.query<{ id: string; email: string; display_name: string; status: string }>(
        `SELECT u.id, u.email, u.display_name, u.status
           FROM user_identities i JOIN users u ON u.id = i.user_id
          WHERE i.provider = $1 AND i.subject = $2`,
        [profile.provider, profile.subject],
      );
      if (linked.rows[0]) {
        await tx.query(
          "UPDATE user_identities SET last_login_at = now(), email = coalesce($3, email) WHERE provider = $1 AND subject = $2",
          [profile.provider, profile.subject, profile.email],
        );
        return { row: linked.rows[0], created: false };
      }
      if (!profile.email) throw new SocialLoginError("missing_email");
      const existing = await tx.query<{ id: string; email: string; display_name: string; status: string }>(
        "SELECT id, email, display_name, status FROM users WHERE email = $1 FOR UPDATE",
        [profile.email],
      );
      let row = existing.rows[0];
      let created = false;
      if (row) {
        if (!profile.emailVerified) throw new SocialLoginError("email_in_use");
      } else {
        if (!allowSignup) throw new SocialLoginError("signup_disabled");
        const inserted = await tx.query<{ id: string; email: string; display_name: string; status: string }>(
          `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, NULL)
           RETURNING id, email, display_name, status`,
          [profile.email, displayNameFor(profile)],
        );
        row = inserted.rows[0]!;
        created = true;
      }
      await tx.query("INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)", [
        profile.provider,
        profile.subject,
        row.id,
        profile.email,
      ]);
      return { row, created };
    });

  let result;
  try {
    result = await resolve();
  } catch (err) {
    // Dos vueltas simultáneas con la misma identidad o el mismo correo: la segunda ya la encuentra.
    if (!isUniqueViolation(err)) throw err;
    result = await resolve();
  }
  if (result.row.status !== "active") throw new SocialLoginError("account_disabled");
  const session = await createSession(result.row.id);
  return {
    user: { id: result.row.id, email: result.row.email, displayName: result.row.display_name },
    session,
    created: result.created,
  };
}


