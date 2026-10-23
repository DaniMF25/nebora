import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";
import { pickClientIp } from "@/server/request-ip";

const h = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("IP del cliente para límites de peticiones", () => {
  it("con cabecera de confianza ignora X-Forwarded-For falseado", () => {
    const req = h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9", "fly-client-ip": "203.0.113.9" });
    expect(pickClientIp(req, "fly-client-ip")).toBe("203.0.113.9");
    expect(pickClientIp(h({ "x-forwarded-for": "1.2.3.4" }), "fly-client-ip")).toBe("desconocido");
  });

  it("sin cabecera de confianza usa la primera IP de X-Forwarded-For o X-Real-IP", () => {
    expect(pickClientIp(h({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
    expect(pickClientIp(h({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(pickClientIp(h({}))).toBe("desconocido");
  });

  it("CLIENT_IP_HEADER se valida y se normaliza", () => {
    const DB = "postgres://u:p@localhost/db";
    expect(parseEnv({ DATABASE_URL: DB, CLIENT_IP_HEADER: "Fly-Client-IP" }).CLIENT_IP_HEADER).toBe("fly-client-ip");
    expect(() => parseEnv({ DATABASE_URL: DB, CLIENT_IP_HEADER: "x: y" })).toThrow(/CLIENT_IP_HEADER/);
  });
});
