import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/server/same-origin";

const h = (init: Record<string, string>) => new Headers(init);

describe("comprobación de origen de Route Handlers", () => {
  it("acepta la propia aplicación, también detrás de un proxy con https", () => {
    expect(isSameOrigin(h({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(
      isSameOrigin(
        h({ origin: "https://app.ejemplo.com", host: "10.0.0.5:3000", "x-forwarded-host": "app.ejemplo.com" }),
      ),
    ).toBe(true);
  });

  it("rechaza otras webs, peticiones sin Origin y valores raros", () => {
    expect(isSameOrigin(h({ origin: "https://malo.example", host: "app.ejemplo.com" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "https://app.ejemplo.com.malo.example", host: "app.ejemplo.com" }))).toBe(false);
    expect(isSameOrigin(h({ host: "app.ejemplo.com" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "null", host: "app.ejemplo.com" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "https://app.ejemplo.com" }))).toBe(false);
  });
});
