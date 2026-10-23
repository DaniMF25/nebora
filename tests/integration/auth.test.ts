import { describe, expect, it } from "vitest";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_PER_IP,
  login,
  REGISTER_MAX_PER_IP_PER_HOUR,
  registerUser,
  revokeAllSessions,
  revokeSession,
  validateSessionToken,
} from "@/server/auth/service";
import { hashSessionToken } from "@/server/auth/tokens";
import {
  ConflictError,
  FeatureDisabledError,
  InvalidCredentialsError,
  RateLimitedError,
  ValidationError,
} from "@/server/errors";
import { withAdminClient } from "../support/db";
import { createTestUser, TEST_PASSWORD, uniqueSuffix } from "../support/factories";

describe("registro", () => {
  it("está desactivado por defecto", async () => {
    await expect(
      registerUser({ email: `x-${uniqueSuffix()}@example.test`, displayName: "X", password: TEST_PASSWORD }),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it("guarda la contraseña con hash y normaliza el correo", async () => {
    const email = `Mixed-${uniqueSuffix()}@Example.TEST`;
    const user = await registerUser(
      { email, displayName: "Mixta", password: TEST_PASSWORD },
      { allowSignup: true },
    );
    expect(user.email).toBe(email.toLowerCase());
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT password_hash FROM users WHERE id = $1", [user.id]),
    );
    expect(rows[0].password_hash).toMatch(/^scrypt\$17\$8\$1\$/);
    expect(rows[0].password_hash).not.toContain(TEST_PASSWORD);
  });

  it("rechaza contraseñas cortas, campos extra y correos duplicados", async () => {
    await expect(
      registerUser({ email: "short@example.test", displayName: "S", password: "corta" }, { allowSignup: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      registerUser(
        { email: "role@example.test", displayName: "R", password: TEST_PASSWORD, role: "owner" },
        { allowSignup: true },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const user = await createTestUser("dup");
    await expect(
      registerUser(
        { email: user.email.toUpperCase(), displayName: "Dup", password: TEST_PASSWORD },
        { allowSignup: true },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("inicio de sesión y sesiones", () => {
  it("crea una sesión válida y almacena solo el hash del token", async () => {
    const user = await createTestUser("login");
    const { session, user: logged } = await login({ email: user.email, password: TEST_PASSWORD });
    expect(logged.id).toBe(user.id);
    const validated = await validateSessionToken(session.token);
    expect(validated?.user.id).toBe(user.id);

    const { rows } = await withAdminClient((c) => c.query("SELECT id FROM sessions WHERE user_id = $1", [user.id]));
    expect(rows.map((r) => r.id)).toEqual([hashSessionToken(session.token)]);
    expect(rows[0].id).not.toBe(session.token);
  });

  it("da el mismo error para contraseña incorrecta y usuario inexistente", async () => {
    const user = await createTestUser("wrong");
    const a = await login({ email: user.email, password: "otra-contraseña-larga" }).catch((e) => e);
    const b = await login({ email: `nadie-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD }).catch(
      (e) => e,
    );
    expect(a).toBeInstanceOf(InvalidCredentialsError);
    expect(b).toBeInstanceOf(InvalidCredentialsError);
    expect(a.message).toBe(b.message);
  });

  it("bloquea temporalmente tras demasiados fallos, incluso con la contraseña correcta", async () => {
    const user = await createTestUser("brute");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await expect(login({ email: user.email, password: "contraseña-incorrecta" })).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    }
    await expect(login({ email: user.email, password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("rechaza tokens inválidos, revocados y caducados", async () => {
    expect(await validateSessionToken(undefined)).toBeNull();
    expect(await validateSessionToken("no-es-un-token")).toBeNull();
    expect(await validateSessionToken("A".repeat(43))).toBeNull();

    const user = await createTestUser("revoke");
    const s1 = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    await revokeSession(s1.token);
    expect(await validateSessionToken(s1.token)).toBeNull();

    const s2 = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    await withAdminClient((c) =>
      c.query(
        "UPDATE sessions SET created_at = now() - interval '40 days', expires_at = now() - interval '1 minute' WHERE id = $1",
        [hashSessionToken(s2.token)],
      ),
    );
    expect(await validateSessionToken(s2.token)).toBeNull();
  });

  it("revocar todas las sesiones invalida cada una", async () => {
    const user = await createTestUser("revoke-all");
    const s1 = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    const s2 = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    await revokeAllSessions(user.id);
    expect(await validateSessionToken(s1.token)).toBeNull();
    expect(await validateSessionToken(s2.token)).toBeNull();
  });

  it("un usuario deshabilitado no puede iniciar sesión y pierde sus sesiones", async () => {
    const user = await createTestUser("disabled");
    const s = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    await withAdminClient((c) => c.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]));
    expect(await validateSessionToken(s.token)).toBeNull();
    await expect(login({ email: user.email, password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("renueva la caducidad de sesiones próximas a expirar", async () => {
    const user = await createTestUser("renew");
    const s = (await login({ email: user.email, password: TEST_PASSWORD })).session;
    await withAdminClient((c) =>
      c.query("UPDATE sessions SET expires_at = now() + interval '1 day' WHERE id = $1", [
        hashSessionToken(s.token),
      ]),
    );
    const v = await validateSessionToken(s.token);
    expect(v!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 24 * 3600 * 1000);
  });
});

describe("límites por IP", () => {
  it("el login se frena por IP aunque se repartan los intentos entre muchas cuentas", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}-${uniqueSuffix()}`;
    const user = await createTestUser("ip-limit");
    // Cada intento a un correo distinto: el límite por correo no actúa.
    for (let i = 0; i < LOGIN_MAX_PER_IP; i++) {
      await expect(
        login({ email: `nadie-${i}-${uniqueSuffix()}@example.test`, password: "incorrecta-larga" }, { clientId: ip }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // Agotado: ni siquiera la contraseña correcta entra desde esa IP…
    await expect(login({ email: user.email, password: TEST_PASSWORD }, { clientId: ip })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    // …pero desde otra IP sí, y la huella guardada no contiene la IP.
    await expect(login({ email: user.email, password: TEST_PASSWORD }, { clientId: `${ip}-otra` })).resolves.toBeDefined();
    const buckets = await withAdminClient((c) =>
      c.query<{ bucket: string }>("SELECT DISTINCT bucket FROM rate_limit_hits WHERE bucket LIKE 'login-ip:%'"),
    );
    expect(buckets.rows.every((r) => !r.bucket.includes("198.51.100"))).toBe(true);
  });

  it("el registro se frena por IP", async () => {
    const ip = `203.0.113.7-${uniqueSuffix()}`;
    const signup = (n: number) =>
      registerUser(
        { email: `alta-${n}-${uniqueSuffix()}@example.test`, displayName: "Alta", password: TEST_PASSWORD },
        { allowSignup: true, clientId: ip },
      );
    for (let i = 0; i < REGISTER_MAX_PER_IP_PER_HOUR; i++) await signup(i);
    await expect(signup(999)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

