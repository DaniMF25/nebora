import { describe, expect, it } from "vitest";
import { signInWithIdentity, SocialLoginError } from "@/server/auth/oauth/service";
import type { ProviderProfile } from "@/server/auth/oauth/providers";
import { login, registerUser, validateSessionToken } from "@/server/auth/service";
import { InvalidCredentialsError } from "@/server/errors";
import { withAdminClient, withAppClient } from "../support/db";
import { uniqueSuffix } from "../support/factories";

const PASSWORD = "contraseña-de-prueba-larga";
const profile = (over: Partial<ProviderProfile> = {}): ProviderProfile => ({
  provider: "google",
  subject: `sub-${uniqueSuffix()}`,
  email: `social-${uniqueSuffix()}@example.test`,
  emailVerified: true,
  name: "Ana Social",
  ...over,
});
const rejectsWith = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e) => e instanceof SocialLoginError && e.code === code);

// Inicio de sesión con Google, Apple y Facebook (D-061).
describe("inicio de sesión con proveedores", () => {
  it("alta sin contraseña si el registro está habilitado; la siguiente vez entra en la misma cuenta", async () => {
    const p = profile();
    const first = await signInWithIdentity(p, { allowSignup: true });
    expect(first.created).toBe(true);
    expect(first.user).toMatchObject({ email: p.email, displayName: "Ana Social" });
    expect((await validateSessionToken(first.session.token))?.user.id).toBe(first.user.id);
    // Aunque el proveedor cambie el correo, la identidad (subject) es la misma cuenta.
    const again = await signInWithIdentity({ ...p, email: `otro-${uniqueSuffix()}@example.test` }, { allowSignup: false });
    expect(again).toMatchObject({ created: false, user: { id: first.user.id } });
    // Sin contraseña no se puede entrar con correo y contraseña (se compara con un hash de relleno).
    await expect(login({ email: p.email, password: PASSWORD })).rejects.toBeInstanceOf(InvalidCredentialsError);
    const { rows } = await withAdminClient((c) => c.query("SELECT password_hash FROM users WHERE id = $1", [first.user.id]));
    expect(rows[0].password_hash).toBeNull();
  });

  it("sin registro habilitado no crea cuentas", async () => {
    await rejectsWith(signInWithIdentity(profile(), { allowSignup: false }), "signup_disabled");
  });

  it("vincula a la cuenta existente si el proveedor garantiza el correo (Google, Apple)", async () => {
    const email = `existente-${uniqueSuffix()}@example.test`;
    const user = await registerUser({ email, displayName: "Luis", password: PASSWORD }, { allowSignup: true });
    const apple = await signInWithIdentity(profile({ provider: "apple", email, emailVerified: true, name: null }), {
      allowSignup: false,
    });
    expect(apple).toMatchObject({ created: false, user: { id: user.id, displayName: "Luis" } });
    // La contraseña sigue sirviendo.
    expect((await login({ email, password: PASSWORD })).user.id).toBe(user.id);
  });

  it("no vincula si el proveedor no garantiza el correo (Facebook): podría ser la cuenta de otra persona", async () => {
    const email = `victima-${uniqueSuffix()}@example.test`;
    await registerUser({ email, displayName: "Víctima", password: PASSWORD }, { allowSignup: true });
    await rejectsWith(
      signInWithIdentity(profile({ provider: "facebook", email, emailVerified: false }), { allowSignup: true }),
      "email_in_use",
    );
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM user_identities WHERE email = $1", [email]),
    );
    expect(rows[0].n).toBe(0);
    // Con un correo nuevo, Facebook sí puede crear la cuenta.
    const fresh = await signInWithIdentity(profile({ provider: "facebook", emailVerified: false }), { allowSignup: true });
    expect(fresh.created).toBe(true);
  });

  it("sin correo no se puede dar de alta; una cuenta desactivada no entra", async () => {
    await rejectsWith(signInWithIdentity(profile({ email: null, emailVerified: false }), { allowSignup: true }), "missing_email");
    const p = profile();
    const { user } = await signInWithIdentity(p, { allowSignup: true });
    await withAdminClient((c) => c.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]));
    await rejectsWith(signInWithIdentity(p), "account_disabled");
  });

  it("dos vueltas simultáneas con la misma identidad crean una sola cuenta", async () => {
    const p = profile();
    const [a, b] = await Promise.all([
      signInWithIdentity(p, { allowSignup: true }),
      signInWithIdentity(p, { allowSignup: true }),
    ]);
    expect(a.user.id).toBe(b.user.id);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [p.email]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("el rol de la aplicación no puede cambiar a qué cuenta apunta una identidad", async () => {
    const { user } = await signInWithIdentity(profile(), { allowSignup: true });
    await withAppClient(async (c) => {
      await expect(c.query("UPDATE user_identities SET user_id = $1", [user.id])).rejects.toThrow(/permission denied/);
      await expect(c.query("DELETE FROM user_identities")).rejects.toThrow(/permission denied/);
    });
  });
});
