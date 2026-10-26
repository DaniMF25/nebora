import { describe, expect, it } from "vitest";
import { isCountableView, isPrefetchRequest } from "@/lib/view-filter";

const CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("qué cuenta como visita", () => {
  it("cuenta navegadores normales sin sesión", () => {
    for (const ua of [CHROME, SAFARI]) {
      expect(isCountableView({ userAgent: ua, prefetch: false, hasSession: false })).toBe(true);
    }
  });

  it("no cuenta robots, vistas previas de enlaces, herramientas ni navegadores sin interfaz", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "WhatsApp/2.23.20.0",
      "curl/8.5.0",
      "python-requests/2.31",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36",
      "",
    ]) {
      expect(isCountableView({ userAgent: ua, prefetch: false, hasSession: false })).toBe(false);
    }
    expect(isCountableView({ userAgent: null, prefetch: false, hasSession: false })).toBe(false);
  });

  it("no cuenta precargas ni visitas con sesión de Nébora", () => {
    expect(isCountableView({ userAgent: CHROME, prefetch: true, hasSession: false })).toBe(false);
    expect(isCountableView({ userAgent: CHROME, prefetch: false, hasSession: true })).toBe(false);
  });

  it("detecta las cabeceras de precarga", () => {
    const h = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;
    expect(isPrefetchRequest(h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest(h({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(h({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchRequest(h({ rsc: "1" }))).toBe(false);
    expect(isPrefetchRequest(h({}))).toBe(false);
  });
});
