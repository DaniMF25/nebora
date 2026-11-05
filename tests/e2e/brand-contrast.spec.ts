import { expect, test } from "@playwright/test";
import { contrastRatio } from "../../src/lib/color";
import { createOrganization, register, setSitePublished, suffix } from "./helpers";

/** «rgb(29, 47, 74)» → «#1d2f4a». */
function hex(rgb: string): string {
  const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("")}`;
}

// Color de marca oscuro (D-051): separadores con el color de marca y textos legibles en cada fondo.
test("color de marca oscuro: separadores con la marca y contraste AA en página, portada y pie", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await register(page, "Contraste");
  await createOrganization(page, "Casa Contraste", "advanced");
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill(`puerto-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();
  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Teléfono", { exact: true }).fill("+34 600 111 222");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  // Estilo Mediterráneo (el de partida): portada y pie oscuros.
  await page.goto(`${est}/site?tab=estilo`);
  await expect(page.getByRole("article", { name: "Estilo Mediterráneo" }).getByText("Actual")).toBeVisible();
  await page.goto(`${est}/site?tab=marca`);
  await page.getByLabel("Usar mi color de marca").check();
  await page.locator('input[name="accentColor"]').fill("#1d2f4a");
  await page.getByRole("button", { name: "Guardar color y tipografía" }).click();
  await expect(page.getByText("Marca guardada", { exact: true })).toBeVisible();
  await expect(page.getByText("tu web usará este color ajustado")).toBeVisible();
  const home = (await page.getByRole("link", { name: "Ver página pública" }).getAttribute("href"))!;

  const v = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await v.goto(home);
  const colors = await v.evaluate(() => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop) : "");
    const block = document.querySelector("#contacto-cta")!.closest("section")!;
    const footer = document.querySelector("footer")!;
    const hero = document.querySelector("h1")!.closest("section")!;
    return {
      blockRule: getComputedStyle(block.querySelector("h2")!, "::after").getPropertyValue("background-color"),
      pageBg: css(document.querySelector("div[lang]"), "background-color"),
      heroRule: css(hero.querySelector('span[aria-hidden="true"]'), "background-color"),
      footerLabel: css(footer.querySelector("h2"), "color"),
      footerBg: css(footer, "background-color"),
    };
  });
  // El separador del bloque de contacto usa el color de marca (no el secundario del estilo).
  expect(hex(colors.blockRule)).toBe("#1d2f4a");
  expect(contrastRatio(hex(colors.blockRule), hex(colors.pageBg))).toBeGreaterThanOrEqual(4.5);
  // En la portada y en el pie (oscuros) se aclara hasta leerse.
  expect(hex(colors.heroRule)).not.toBe("#1d2f4a");
  expect(contrastRatio(hex(colors.footerLabel), hex(colors.footerBg))).toBeGreaterThanOrEqual(4.5);
});
