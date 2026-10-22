import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { generateSessionToken, hashSessionToken, SESSION_TOKEN_PATTERN } from "@/server/auth/tokens";

describe("hash de contraseñas", () => {
  it("verifica la contraseña correcta y rechaza otras", async () => {
    const hash = await hashPassword("una contraseña bastante larga");
    expect(await verifyPassword("una contraseña bastante larga", hash)).toBe(true);
    expect(await verifyPassword("una contraseña bastante larg", hash)).toBe(false);
  });

  it("usa sal aleatoria", async () => {
    const [a, b] = await Promise.all([hashPassword("misma-contraseña-x"), hashPassword("misma-contraseña-x")]);
    expect(a).not.toBe(b);
  });

  it("rechaza hashes mal formados o con parámetros fuera de rango", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$foo")).toBe(false);
    expect(await verifyPassword("x", "scrypt$30$8$1$AAAA$AAAA")).toBe(false);
  });
});

describe("tokens de sesión", () => {
  it("son únicos, con formato fijo, y su hash es determinista", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(SESSION_TOKEN_PATTERN);
    expect(hashSessionToken(t1)).toBe(hashSessionToken(t1));
    expect(hashSessionToken(t1)).toMatch(/^[0-9a-f]{64}$/);
  });
});
