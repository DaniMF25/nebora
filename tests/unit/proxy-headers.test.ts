import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

describe("cabeceras de seguridad del proxy (D-044)", () => {
  it("por https añade HSTS y upgrade-insecure-requests", () => {
    const res = proxy(new NextRequest("https://app.ejemplo.com/login"));
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(res.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });

  it("detrás de un proxy que termina TLS (x-forwarded-proto) también", () => {
    const res = proxy(new NextRequest("http://10.0.0.5:3000/login", { headers: { "x-forwarded-proto": "https" } }));
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("cada respuesta lleva un nonce distinto y sin unsafe-inline en scripts", () => {
    const a = proxy(new NextRequest("http://localhost/login")).headers.get("content-security-policy")!;
    const b = proxy(new NextRequest("http://localhost/login")).headers.get("content-security-policy")!;
    const nonce = (csp: string) => /'nonce-([^']+)'/.exec(csp)![1];
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
