import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKING_TEXTS, translateBookingMessage } from "@/lib/booking-i18n";
import { LANGUAGES } from "@/lib/languages";

/** Mensajes fijos en español que puede devolver la reserva online (servicio y acción). */
function serverMessages(): string[] {
  const root = path.resolve(import.meta.dirname, "../..");
  const sources = [
    "src/server/modules/public-booking/service.ts",
    "src/app/r/[orgSlug]/[estSlug]/actions.ts",
    "src/server/validation.ts",
    "src/server/actions/form-state.ts",
  ].map((f) => readFileSync(path.join(root, f), "utf8"));
  const patterns = [
    /(?:ValidationError|ConflictError|RateLimitedError)\("([^"]+)"/g,
    /message: "([^"]+)"/g,
    /\.min\(1, "([^"]+)"\)/g,
    /error: "([^"]+)"/g,
  ];
  const found = new Set<string>();
  for (const src of sources) for (const re of patterns) for (const m of src.matchAll(re)) found.add(m[1]!);
  return [...found];
}

describe("reserva online traducida", () => {
  it("traduce los mensajes del servidor, también los que llevan números", () => {
    expect(translateBookingMessage("Indica tu nombre", "en")).toBe("Please enter your name");
    expect(translateBookingMessage("Online se admiten de 2 a 8 comensales", "fr")).toBe("En ligne, de 2 à 8 couverts");
    expect(translateBookingMessage("Mensaje desconocido", "de")).toBe("Mensaje desconocido");
    expect(translateBookingMessage("Indica tu nombre", "es")).toBe("Indica tu nombre");
  });

  it("todos los mensajes fijos del servidor tienen traducción en todos los idiomas", () => {
    const messages = serverMessages();
    expect(messages.length).toBeGreaterThan(15);
    for (const lang of LANGUAGES) {
      const missing = messages.filter((m) => translateBookingMessage(m, lang) === m);
      expect(missing, `${lang}: ${missing.join(" | ")}`).toEqual([]);
    }
  });

  it("los textos de la página dependen del idioma y del número de personas", () => {
    expect(BOOKING_TEXTS.en.people(1)).toBe("1 person");
    expect(BOOKING_TEXTS.de.people(4)).toBe("4 Personen");
    expect(BOOKING_TEXTS.ca.consent("Casa", 90)).toContain("90 dies");
  });
});
