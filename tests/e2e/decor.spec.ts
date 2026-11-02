import { expect, test } from "@playwright/test";
import { createOrganization, register, setSitePublished, suffix } from "./helpers";

// Fondo decorativo de la web (D-050).
test("fondo decorativo: se elige en Estilo y la web lo muestra sin violaciones de CSP", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await register(page, "Fondo");
  await createOrganization(page, "Casa Fondo", "advanced");
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill(`puerto-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();
  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  const home = (await page.getByRole("link", { name: "Ver página pública" }).getAttribute("href"))!;

  const visitor = await (await browser.newContext()).newPage();
  const violations: string[] = [];
  visitor.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const decorVar = () =>
    visitor.evaluate(() => getComputedStyle(document.querySelector("div[lang]")!).getPropertyValue("--s-decor"));
  await visitor.goto(home);
  expect(await decorVar()).toBe("");

  await page.goto(`${est}/site?tab=estilo`);
  await page.getByRole("radio", { name: /Mariscos y pescado/ }).check();
  await page.getByRole("button", { name: "Guardar fondo" }).click();
  await expect(page.getByText("Fondo guardado")).toBeVisible();

  await visitor.reload();
  expect(await decorVar()).toContain("data:image/svg+xml");
  // La capa decorativa existe, es muy tenue y no recibe clics.
  const layer = await visitor.evaluate(() => {
    const s = getComputedStyle(document.querySelector("div[lang]")!, "::before");
    return { opacity: Number(s.opacity), events: s.pointerEvents };
  });
  expect(layer.opacity).toBeGreaterThan(0);
  expect(layer.opacity).toBeLessThan(0.15);
  expect(layer.events).toBe("none");
  await visitor.goto(`${home}/contacto`);
  expect(await decorVar()).toContain("data:image/svg+xml");
  expect(violations, violations.join("\n")).toEqual([]);

  // Sin fondo otra vez.
  await page.getByRole("radio", { name: /Sin fondo/ }).check();
  await page.getByRole("button", { name: "Guardar fondo" }).click();
  await expect(page.getByText("Fondo guardado")).toBeVisible();
  await visitor.goto(home);
  expect(await decorVar()).toBe("");
});
