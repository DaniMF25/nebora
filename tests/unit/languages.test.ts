import { describe, expect, it } from "vitest";
import { ALLERGENS } from "@/lib/allergens";
import { LANGUAGES, resolvePublicLanguage, withLang } from "@/lib/languages";
import { localizeSnapshot, type MenuSnapshot } from "@/lib/menu-snapshot";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { groupOpeningHours } from "@/lib/site-hours";

describe("idioma de las páginas públicas", () => {
  it("prioriza ?lang= si el local lo ofrece", () => {
    expect(resolvePublicLanguage("en", "fr-FR,fr;q=0.9", ["en", "fr"])).toBe("en");
    expect(resolvePublicLanguage("es", "en-GB,en;q=0.9", ["en"])).toBe("es");
    expect(resolvePublicLanguage(["fr", "en"], null, ["fr"])).toBe("fr");
  });

  it("un ?lang= no ofrecido o inventado cae en español (no en el del navegador)", () => {
    expect(resolvePublicLanguage("de", "en", ["en"])).toBe("es");
    expect(resolvePublicLanguage("<script>", "en", ["en"])).toBe("es");
  });

  it("sin ?lang= usa el primer idioma del navegador que se ofrezca, por peso", () => {
    expect(resolvePublicLanguage(undefined, "de-DE,de;q=0.9,en;q=0.8", ["en"])).toBe("en");
    expect(resolvePublicLanguage(undefined, "en;q=0.5,fr;q=0.9", ["en", "fr"])).toBe("fr");
    expect(resolvePublicLanguage(undefined, "es-ES,en;q=0.8", ["en"])).toBe("es");
    expect(resolvePublicLanguage(undefined, "ja", ["en"])).toBe("es");
    expect(resolvePublicLanguage(undefined, null, ["en"])).toBe("es");
    expect(resolvePublicLanguage(undefined, "en", [])).toBe("es");
  });

  it("añade el idioma a los enlaces conservando la consulta y el ancla", () => {
    expect(withLang("/a/b", "en")).toBe("/a/b?lang=en");
    expect(withLang("/a/b?x=1", "es")).toBe("/a/b?x=1&lang=es");
    expect(withLang("/a/b#contacto", "fr")).toBe("/a/b?lang=fr#contacto");
  });
});

describe("textos fijos públicos", () => {
  it("todos los idiomas tienen todos los textos y los 14 alérgenos", () => {
    const keys = Object.keys(PUBLIC_TEXTS.es).sort();
    for (const lang of ["es", ...LANGUAGES] as const) {
      const t = PUBLIC_TEXTS[lang];
      expect(Object.keys(t).sort()).toEqual(keys);
      expect(t.shortDays).toHaveLength(7);
      for (const a of ALLERGENS) expect(t.allergenNames[a]).toMatch(/\S/);
      for (const [k, v] of Object.entries(t)) if (typeof v === "string") expect(v, `${lang}.${k}`).toMatch(/\S/);
    }
  });

  it("el horario usa los días del idioma", () => {
    const slots = [1, 2, 3].map((weekday) => ({ weekday, opensMinute: 780, durationMinutes: 180 }));
    expect(groupOpeningHours(slots, PUBLIC_TEXTS.en)[0]!.days).toBe("Mon – Wed");
    expect(groupOpeningHours(slots.slice(0, 2), PUBLIC_TEXTS.fr)[0]!.days).toBe("Lun et Mar");
    expect(groupOpeningHours(slots.slice(0, 2))[0]!.days).toBe("Lun y Mar");
  });
});

describe("carta localizada", () => {
  const snapshot: MenuSnapshot = {
    schemaVersion: 1,
    theme: "moderno",
    organizationName: "Org",
    establishmentName: "Local",
    menuName: "Carta",
    currency: "EUR",
    languages: ["en"],
    menuNameI18n: { en: "Menu" },
    sections: [
      {
        name: "Entrantes",
        i18n: { en: { name: "Starters" } },
        items: [
          {
            name: "Croquetas",
            description: "De jamón",
            priceCents: 900,
            allergens: [],
            i18n: { en: { name: "Croquettes" } },
          },
          { name: "Pan", description: null, priceCents: 200, allergens: [] },
        ],
      },
    ],
  };

  it("traduce lo que hay y deja en español lo que falta", () => {
    const en = localizeSnapshot(snapshot, "en");
    expect(en.menuName).toBe("Menu");
    expect(en.sections[0]!.name).toBe("Starters");
    expect(en.sections[0]!.items.map((i) => [i.name, i.description])).toEqual([
      ["Croquettes", "De jamón"],
      ["Pan", null],
    ]);
  });

  it("un idioma que la versión no ofrecía no cambia nada", () => {
    expect(localizeSnapshot(snapshot, "fr")).toBe(snapshot);
    expect(localizeSnapshot({ ...snapshot, languages: undefined }, "en").menuName).toBe("Carta");
  });
});
