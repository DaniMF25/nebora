import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";

const DB = "postgres://u:secreto-no-mostrar@localhost/db";

describe("configuración del servidor", () => {
  it("aplica valores por defecto seguros", () => {
    const env = parseEnv({ DATABASE_URL: DB });
    expect(env.AUTH_ALLOW_SIGNUP).toBe("false");
    expect(env.APP_BASE_URL).toBeUndefined();
  });

  it("normaliza APP_BASE_URL a un origen y rechaza rutas u otros protocolos", () => {
    expect(parseEnv({ DATABASE_URL: DB, APP_BASE_URL: "https://carta.example.com/" }).APP_BASE_URL).toBe(
      "https://carta.example.com",
    );
    for (const bad of ["https://x.example.com/app", "ftp://x.example.com", "javascript:alert(1)", "x.example.com"]) {
      expect(() => parseEnv({ DATABASE_URL: DB, APP_BASE_URL: bad }), bad).toThrow(/APP_BASE_URL/);
    }
  });

  it("exige https en producción salvo en loopback (pruebas locales)", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, NODE_ENV: "production", APP_BASE_URL: "http://x.example.com" })).toThrow(
      /https/,
    );
    expect(parseEnv({ DATABASE_URL: DB, NODE_ENV: "production", APP_BASE_URL: "http://localhost:3100" }).APP_BASE_URL).toBe(
      "http://localhost:3100",
    );
  });

  it("los errores no revelan valores secretos", () => {
    try {
      parseEnv({ DATABASE_URL: "mysql://u:secreto-no-mostrar@h/db" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("DATABASE_URL");
      expect((err as Error).message).not.toContain("secreto-no-mostrar");
    }
  });
});
