import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { openTab, register, suffix } from "./helpers";

test("marca de la web: logotipo, color propio y tipografía elegida", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Marca");
  const orgSlug = `marca-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Marca");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Marca" })).toBeVisible();
  await page.getByLabel("Nombre").fill("El Faro");
  await page.getByLabel("Identificador (URL)").fill("faro");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "El Faro" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();

  await page.goto(`${estUrl}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Cocina junto al mar");
  await page.getByLabel("Publicar la página").check();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();

  await openTab(page, "Marca");
  await expect(page.getByText("Sin logotipo")).toBeVisible();
  await page.locator('input[name="image"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 480, height: 160, channels: 4, background: { r: 46, g: 134, b: 171, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  });
  await page.getByRole("button", { name: "Subir logotipo" }).click();
  await expect(page.getByRole("img", { name: "Logotipo de El Faro" })).toBeVisible();

  // Cuatro tipografías del estilo (Mediterráneo por defecto); la original marcada.
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(page.getByRole("radio", { name: /Original/ })).toBeChecked();
  await page.getByLabel("Usar mi color de marca").check();
  await page.locator('input[name="accentColor"]').fill("#2e86ab");
  await page.getByRole("radio", { name: /Editorial/ }).check();
  await page.getByRole("button", { name: "Guardar color y tipografía" }).click();
  await expect(page.getByText("Marca guardada", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Editorial/ })).toBeChecked();
  await expect(page.locator('input[name="accentColor"]')).toHaveValue("#2e86ab");

  // Vista previa de otra tipografía sin guardarla.
  const previewHref = (await page.getByRole("link", { name: "Vista previa" }).nth(2).getAttribute("href"))!;
  expect(previewHref).toMatch(/font=med-cinzel$/);
  const preview = await ctx.newPage();
  await preview.goto(previewHref);
  await expect(preview.getByText(/letra clásica romana \(Cinzel y Raleway\)/)).toBeVisible();
  await preview.close();

  // El visitante ve el logotipo, el color y la letra.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/${orgSlug}/faro`);
  const logo = visitor.getByRole("banner").getByRole("img", { name: "El Faro" });
  await expect(logo).toBeVisible();
  const logoSrc = (await logo.getAttribute("src"))!;
  expect((await visitor.request.get(logoSrc)).headers()["content-type"]).toBe("image/webp");
  const title = visitor.getByRole("heading", { level: 1, name: "Cocina junto al mar" });
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Playfair/);
  expect(
    await visitor
      .locator("body div[lang]")
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--s-accent").trim()),
  ).toBe("#2e86ab");

  // Sin color propio vuelve el del estilo.
  await page.getByLabel("Usar mi color de marca").uncheck();
  await page.getByRole("button", { name: "Guardar color y tipografía" }).click();
  await expect(page.getByText("Marca guardada", { exact: true })).toBeVisible();
  await visitor.reload();
  expect(
    await visitor
      .locator("body div[lang]")
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--s-accent").trim()),
  ).toBe("#b48c56");
});
