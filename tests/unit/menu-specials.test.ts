import { describe, expect, it } from "vitest";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { specialStatus, withSpecials } from "@/server/modules/menus/specials";

describe("estado de un plato fuera de carta", () => {
  const base = { startsOn: null, endsOn: null, active: true, available: true };
  const today = "2026-10-31";

  it("sin fechas se ve siempre; con fechas, solo dentro (ambos días incluidos)", () => {
    expect(specialStatus(base, today)).toBe("visible");
    expect(specialStatus({ ...base, startsOn: today, endsOn: today }, today)).toBe("visible");
    expect(specialStatus({ ...base, startsOn: "2026-11-01" }, today)).toBe("scheduled");
    expect(specialStatus({ ...base, endsOn: "2026-10-30" }, today)).toBe("expired");
  });

  it("un producto archivado o no disponible en el local no se ve", () => {
    expect(specialStatus({ ...base, active: false }, today)).toBe("archived");
    expect(specialStatus({ ...base, available: false }, today)).toBe("unavailable");
  });
});

describe("carta con fuera de carta", () => {
  const snapshot = {
    schemaVersion: 1,
    theme: "moderno",
    organizationName: "Casa",
    establishmentName: "Puerto",
    menuName: "Carta",
    currency: "EUR",
    sections: [{ name: "Entrantes", items: [] }],
  } satisfies MenuSnapshot;
  const special = { name: "Rodaballo", description: null, priceCents: 2800, allergens: ["fish" as const] };

  it("los platos van en una primera sección con el título dado", () => {
    const result = withSpecials(snapshot, [special], "Fuera de carta");
    expect(result.sections.map((s) => s.name)).toEqual(["Fuera de carta", "Entrantes"]);
    expect(result.sections[0]!.items).toEqual([special]);
  });

  it("sin platos, la carta queda igual", () => {
    expect(withSpecials(snapshot, [], "Fuera de carta")).toBe(snapshot);
  });
});
