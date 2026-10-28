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

  // Tamaño del logotipo: mediano por defecto; se elige grande.
  await expect(page.getByRole("radio", { name: "Mediano" })).toBeChecked();
  await page.getByRole("radio", { name: "Grande" }).check();
  await page.getByRole("button", { name: "Guardar tamaño" }).click();
  await expect(page.getByText("Tamaño guardado", { exact: true })).toBeVisible();

  // Cuatro tipografías del estilo (Mediterráneo por defecto); la original marcada.
  const pairings = page.locator("fieldset", { hasText: "Tipografía del estilo" }).getByRole("radio");
  await expect(pairings).toHaveCount(4);
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
  expect(await logo.evaluate((el) => getComputedStyle(el).maxHeight)).toBe("104px");
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

test("web pública: hovers con los colores del tema y puntos del carrusel solo si hacen falta", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Carrusel");
  const orgSlug = `carrusel-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Carrusel");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Carrusel" })).toBeVisible();
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  for (const name of ["Croquetas", "Pulpo"]) {
    await page.goto(`${orgPath}/products`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Precio (€)").fill("9");
    await form.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.locator("ul.cards").getByText(name, { exact: true })).toBeVisible();
  }
  await page.goto(orgPath);
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  await page.getByRole("link", { name: "Gestionar cartas" }).click();
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  for (const section of ["Entrantes", "Del mar"]) {
    await page.getByPlaceholder("Nueva categoría").fill(section);
    await page.getByRole("button", { name: "Añadir categoría" }).click();
    await expect(page.getByRole("heading", { name: section, level: 4 })).toBeVisible();
  }
  for (const [section, dish] of [
    ["Entrantes", "Croquetas"],
    ["Entrantes", "Pulpo"],
  ] as const) {
    await page.getByLabel(`Producto para ${section}`).selectOption({ label: `${dish} (9,00 €)` });
    await page.getByRole("button", { name: `Añadir a ${section}` }).click();
    await expect(page.getByRole("button", { name: `Quitar ${dish}` })).toBeVisible();
  }
  await page.getByLabel("Producto para Del mar").selectOption({ label: "Pulpo (9,00 €)" });
  await page.getByRole("button", { name: "Añadir a Del mar" }).click();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();
  await page.goto(`${estUrl}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Carta destacada").selectOption({ label: "Carta" });
  await page.getByLabel("Publicar la página").check();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();

  // Escritorio: los dos platos caben, no hay puntos.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await visitor.goto(`/${orgSlug}/puerto`);
  await expect(visitor.getByRole("heading", { name: "Pulpo" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Ver Croquetas" })).toHaveCount(0);

  // El hover de una pestaña no se pinta con el violeta del panel.
  const tab = visitor.getByRole("tab", { name: "Del mar" });
  await tab.hover();
  expect(await tab.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  // Móvil: no caben, aparecen los puntos.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/${orgSlug}/puerto`);
  await expect(phone.getByRole("button", { name: "Ver Croquetas" })).toBeVisible();
});
