import { describe, expect, it } from "vitest";
import { contrastRatio, normalizeHex, readableOn } from "@/lib/color";
import { MENU_THEMES } from "@/lib/menu-snapshot";
import { FONT_KEYS, FONT_PAIRINGS, pairingStyle, pairingsFor, resolvePairing } from "@/lib/site-fonts";

describe("color de marca", () => {
  it("solo acepta #RRGGBB y lo normaliza", () => {
    expect(normalizeHex(" #B48C56 ")).toBe("#b48c56");
    for (const bad of ["b48c56", "#abc", "#gggggg", "red", "#b48c56;background:url(x)", ""]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  it("contraste WCAG y texto legible sobre el color", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(readableOn("#ffd400")).toBe("#111111");
    expect(readableOn("#1d2f4a")).toBe("#ffffff");
  });
});

describe("tipografías por estilo", () => {
  it("cuatro por estilo, la primera es la original, ids únicos y fuentes conocidas", () => {
    for (const theme of MENU_THEMES) {
      const options = pairingsFor(theme);
      expect(options).toHaveLength(4);
      expect(options[0]!.name).toBe("Original");
    }
    const ids = FONT_PAIRINGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FONT_PAIRINGS) {
      for (const k of p.fonts) expect(FONT_KEYS).toContain(k);
      // Cada variable usada en las pilas de fuentes está entre las fuentes cargadas.
      for (const used of `${p.display} ${p.body} ${p.brand ?? ""}`.matchAll(/--font-([a-z0-9]+)/g)) {
        expect(p.fonts).toContain(used[1]);
      }
    }
  });

  it("una combinación de otro estilo o desconocida cae en la original del estilo", () => {
    expect(resolvePairing("moderno", "mod-poppins").id).toBe("mod-poppins");
    expect(resolvePairing("moderno", "med-playfair").id).toBe("mod-inter");
    expect(resolvePairing("clasico", null).id).toBe("cla-caveat");
    expect(resolvePairing("futurista", "nada").id).toBe("fut-orbitron");
  });

  it("las variables de estilo cambian titulares y texto (y el nombre en Clásico)", () => {
    expect(pairingStyle(resolvePairing("mediterraneo", "med-cinzel"))).toEqual({
      "--s-font-display": "var(--font-cinzel), Georgia, serif",
      "--s-font-body": "var(--font-raleway), system-ui, sans-serif",
    });
    expect(pairingStyle(resolvePairing("clasico", "cla-dancing"))["--s-font-brand"]).toContain("--font-dancing");
  });
});
