import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("quita tildes, eñes y símbolos y une con guiones", () => {
    expect(slugify("Casa Pepé & Hijos")).toBe("casa-pepe-hijos");
    expect(slugify("  La Viña del Puerto  ")).toBe("la-vina-del-puerto");
    expect(slugify("Bar 'El Rincón' (Centro)")).toBe("bar-el-rincon-centro");
  });

  it("recorta a la longitud máxima sin dejar un guion al final", () => {
    const s = slugify("Restaurante muy largo de cocina mediterránea y de mercado", 30);
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/);
  });

  it("devuelve vacío si no queda un identificador válido", () => {
    expect(slugify("¡¡!!")).toBe("");
    expect(slugify("Yo")).toBe("");
    expect(slugify("東京")).toBe("");
  });
});
