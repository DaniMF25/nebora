import { describe, expect, it } from "vitest";
import { brandPalette, contrastRatio, ensureContrast, mix } from "@/lib/color";
import { THEME_INFO } from "@/lib/site-themes";

// Color de marca legible en cada fondo (D-051).
describe("paleta de marca", () => {
  it("mezcla colores", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#123456", 0.7)).toBe("#123456");
  });

  it("no toca un color que ya contrasta y ajusta el que no", () => {
    expect(ensureContrast("#1d2f4a", "#f3ebdc")).toBe("#1d2f4a");
    const onDark = ensureContrast("#1d2f4a", "#17191c");
    expect(contrastRatio(onDark, "#17191c")).toBeGreaterThanOrEqual(4.5);
    const onLight = ensureContrast("#ffe066", "#fafaf9");
    expect(contrastRatio(onLight, "#fafaf9")).toBeGreaterThanOrEqual(4.5);
  });

  it("con cualquier color y estilo, cada variante se lee sobre su fondo (WCAG AA)", () => {
    const samples = ["#000000", "#ffffff", "#1d2f4a", "#ffe066", "#7a2e1d", "#00ff00", "#3a3a3a", "#b48c56"];
    for (const info of Object.values(THEME_INFO)) {
      for (const accent of samples) {
        const p = brandPalette(accent, { page: info.pageBg, hero: info.heroBg, contact: info.contactBg });
        expect(contrastRatio(p.page, info.pageBg), `${accent} página`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.hero, info.heroBg), `${accent} portada`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.contact, info.contactBg), `${accent} pie`).toBeGreaterThanOrEqual(4.5);
        // El texto de los botones (sobre el color de marca) también se lee.
        expect(contrastRatio(p.onPage, p.page), `${accent} botón`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.onHero, p.hero), `${accent} botón de portada`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
