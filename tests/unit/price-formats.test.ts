import { describe, expect, it } from "vitest";
import { formatEuros } from "@/lib/money";
import { formatLabel, priceSummary, productOptionLabel } from "@/lib/price-formats";

describe("formatos de precio", () => {
  it("traduce los nombres habituales sin distinguir mayúsculas y deja los propios tal cual", () => {
    expect(formatLabel("Media ración", "en")).toBe("Half portion");
    expect(formatLabel("  botella ", "fr")).toBe("Bouteille");
    expect(formatLabel("Ración", "ca")).toBe("Ració");
    expect(formatLabel("Plato del chef", "de")).toBe("Plato del chef");
    expect(formatLabel("Ración", "es")).toBe("Ración");
  });

  it("resume el precio en el panel y en los desplegables", () => {
    const formats = [
      { label: "Media ración", priceCents: 600 },
      { label: "Ración", priceCents: 1000 },
    ];
    const [six, nine, ten] = [600, 900, 1000].map(formatEuros);
    expect(priceSummary(900, null)).toBe(nine);
    expect(priceSummary(600, formats)).toBe(`Media ración ${six} · Ración ${ten}`);
    expect(productOptionLabel({ name: "Croquetas", priceCents: 900, formats: null })).toBe(`Croquetas (${nine})`);
    expect(productOptionLabel({ name: "Calamares", priceCents: 600, formats })).toBe(`Calamares (desde ${six})`);
  });
});
