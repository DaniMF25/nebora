import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTACT_SERVER_MESSAGES, CONTACT_TEXTS, translateContactMessage } from "@/lib/contact-i18n";

const LANGS = Object.keys(CONTACT_TEXTS) as (keyof typeof CONTACT_TEXTS)[];

// Textos del formulario de contacto (D-049).
describe("traducciones del contacto", () => {
  it("todo mensaje del servicio de contacto que puede ver el visitante está en la lista y traducido", () => {
    const source = readFileSync("src/server/modules/contact/service.ts", "utf8").replaceAll(
      "${MAX_MESSAGE_LENGTH}",
      "2000",
    );
    const found = new Set<string>();
    for (const m of source.matchAll(/(?:Error\(|message: |\.min\(1, |MAX_MESSAGE_LENGTH, )\s*[`"]([^`"]+)[`"]/g)) {
      found.add(m[1]!);
    }
    expect(found.size).toBeGreaterThan(8);
    for (const message of found) expect(CONTACT_SERVER_MESSAGES as readonly string[], message).toContain(message);
    for (const lang of LANGS) {
      for (const message of CONTACT_SERVER_MESSAGES) {
        const t = translateContactMessage(message, lang);
        expect(t, `${lang}: ${message}`).toBeTruthy();
        if (lang !== "es") expect(t, `${lang}: ${message}`).not.toBe(message);
      }
      expect(CONTACT_TEXTS[lang].consent("Casa", 365)).toContain("365");
    }
  });
});
