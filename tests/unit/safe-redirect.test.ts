import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("acepta rutas internas", () => {
    expect(safeRedirectPath("/invite/abc")).toBe("/invite/abc");
    expect(safeRedirectPath("/app?x=1")).toBe("/app?x=1");
  });

  it("rechaza destinos externos o ambiguos", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "app",
      "/a\nb",
      "",
      undefined,
      42,
      "/" + "a".repeat(600),
    ]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/app");
    }
  });
});
