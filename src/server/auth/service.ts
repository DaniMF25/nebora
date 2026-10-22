import "server-only";
import { getEnv } from "@/server/config/env";
import { getPool, isUniqueViolation, withTransaction } from "@/server/db/pool";
import {
  ConflictError,
  FeatureDisabledError,
  InvalidCredentialsError,
  RateLimitedError,
} from "@/server/errors";
import { parseInput } from "@/server/validation";
import { getDummyHash, hashPassword, verifyPassword } from "./password";
import { loginSchema, registerSchema } from "./schemas";
import { generateSessionToken, hashSessionToken, SESSION_TOKEN_PATTERN } from "./tokens";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Si a la sesión le queda menos de esto, se renueva al usarla.
const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionInfo {
  token: string;
  expiresAt: Date;
}

export async function registerUser(
  input: unknown,
  options: { allowSignup?: boolean } = {},
): Promise<AuthUser> {
  const allowSignup = options.allowSignup ?? getEnv().AUTH_ALLOW_SIGNUP === "true";
  if (!allowSignup) throw new FeatureDisabledError("El registro de cuentas no está habilitado");

  const data = parseInput(registerSchema, input);
  const passwordHash = await hashPassword(data.password);
  try {
    const { rows } = await getPool().query<{ id: string }>(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [data.email, data.displayName, passwordHash],
    );
    return { id: rows[0]!.id, email: data.email, displayName: data.displayName };
  } catch (err) {
    // Riesgo conocido: revela que el correo existe. Mitigación prevista: flujo
    // con verificación por correo cuando haya proveedor configurado.
    if (isUniqueViolation(err)) throw new ConflictError("No se pudo crear la cuenta con ese correo");
    throw err;
  }
}

export async function login(input: unknown): Promise<{ user: AuthUser; session: SessionInfo }> {
  const { email, password } = parseInput(loginSchema, input);
  const pool = getPool();

  const failures = await pool.query<{ count: string }>(
    `SELECT count(*) FROM auth_login_attempts
      WHERE email = $1 AND NOT succeeded
        AND attempted_at > now() - make_interval(mins => $2)`,
    [email, LOGIN_WINDOW_MINUTES],
  );
  if (Number(failures.rows[0]!.count) >= LOGIN_MAX_FAILURES) throw new RateLimitedError();

  const { rows } = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    status: string;
  }>("SELECT id, email, display_name, password_hash, status FROM users WHERE email = $1", [email]);
  const user = rows[0];

  // Se verifica siempre un hash (aunque el usuario no exista) para no revelar
  // la existencia de cuentas por diferencias de tiempo.
  const passwordOk = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  const valid = Boolean(user && passwordOk && user.status === "active");

  await pool.query("INSERT INTO auth_login_attempts (email, succeeded) VALUES ($1, $2)", [email, valid]);
  if (!valid || !user) throw new InvalidCredentialsError();

  await pool.query(
    "DELETE FROM auth_login_attempts WHERE email = $1 AND attempted_at < now() - interval '1 day'",
    [email],
  );

  const session = await createSession(user.id);
  return { user: { id: user.id, email: user.email, displayName: user.display_name }, session };
}

export async function createSession(userId: string): Promise<SessionInfo> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashSessionToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

/**
 * Valida un token de sesión. Devuelve null si no existe, está revocado o
 * caducado, o el usuario está deshabilitado. Renueva la caducidad por uso.
 */
export async function validateSessionToken(
  token: string | undefined | null,
): Promise<{ user: AuthUser; expiresAt: Date } | null> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const id = hashSessionToken(token);
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    display_name: string;
    expires_at: Date;
  }>(
    `SELECT s.user_id, u.email, u.display_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  let expiresAt = row.expires_at;
  if (expiresAt.getTime() - Date.now() < SESSION_RENEW_THRESHOLD_MS) {
    expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await getPool().query("UPDATE sessions SET expires_at = $2, last_seen_at = now() WHERE id = $1", [
      id,
      expiresAt,
    ]);
  }
  return { user: { id: row.user_id, email: row.email, displayName: row.display_name }, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  if (!SESSION_TOKEN_PATTERN.test(token)) return;
  await getPool().query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [
    hashSessionToken(token),
  ]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
      userId,
    ]);
  });
}
