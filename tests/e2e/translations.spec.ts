import { expect, test } from "@playwright/test";
import { openTab, register, suffix } from "./helpers";

test("traducciones: el local activa inglés, traduce web y carta, y el cliente las ve en su idioma", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Idiomas");
  const orgSlug = `idiomas-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Idiomas");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Idiomas" })).toBeVisible();
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  await page.goto(`${orgPath}/products`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Croquetas");
  await form.getByLabel("Descripción (opcional)").fill("De jamón ibérico");
  await form.getByLabel("Precio (€)").fill("9");
  await form.getByLabel("Gluten", { exact: true }).check();
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.locator("ul.cards").getByText("Croquetas", { exact: true })).toBeVisible();

  await page.goto(orgPath);
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  // Idiomas del local.
  await openTab(page, "Datos del local");
  await page.getByLabel("Inglés").check();
  await page.getByRole("button", { name: "Guardar idiomas" }).click();
  await expect(page.getByText("Idiomas guardados")).toBeVisible();

  // Carta con su traducción.
  await page.goto(estUrl);
  await page.getByRole("link", { name: "Gestionar cartas" }).click();
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.getByPlaceholder("Nueva categoría").fill("Entrantes");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByRole("button", { name: "Añadir a Entrantes" }).click();
  await expect(page.getByRole("button", { name: "Quitar Croquetas" })).toBeVisible();
  await openTab(page, "Traducciones");
  await expect(page.getByText("0 traducidos · 0 por revisar · 3 sin traducir")).toBeVisible();
  await page.getByLabel("Nombre de la carta").fill("Menu");
  await page.getByLabel("Categoría «Entrantes»").fill("Starters");
  await page.getByLabel("Nombre de «Croquetas»").fill("Croquettes");
  await page.getByLabel("Descripción de «Croquetas»").fill("Iberian ham");
  await page.getByRole("button", { name: "Guardar traducción (inglés)" }).click();
  await expect(page.getByText("Traducción guardada")).toBeVisible();
  await page.reload();
  await expect(page.getByText("3 traducidos · 0 por revisar · 0 sin traducir")).toBeVisible();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();

  // Web publicada y traducida (el texto sin traducir queda en español).
  await page.goto(`${estUrl}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos al puerto");
  await page.getByLabel("Texto de bienvenida").fill("Producto del día");
  await page.getByLabel("Carta destacada").selectOption({ label: "Carta" });
  await page.getByLabel("Publicar la página").check();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await openTab(page, "Traducciones");
  await page.getByLabel("Titular").fill("Welcome to the harbour");
  await page.getByRole("button", { name: "Guardar traducción (inglés)" }).click();
  await expect(page.getByText("Traducción guardada")).toBeVisible();

  // Cliente con el navegador en inglés: la web se abre en inglés.
  const sitePath = `/${orgSlug}/puerto`;
  const tourist = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await tourist.goto(sitePath);
  await expect(tourist.getByRole("heading", { level: 1, name: "Welcome to the harbour" })).toBeVisible();
  await expect(tourist.getByText("Producto del día")).toBeVisible();
  await expect(tourist.getByRole("heading", { name: "Our menu" })).toBeVisible();
  await expect(tourist.getByRole("heading", { name: "Croquettes" })).toBeVisible();
  await expect(tourist.getByText("Allergens: Gluten")).toBeVisible();
  // La carta completa sigue en inglés.
  await tourist.getByRole("link", { name: /See the full menu/ }).click();
  await expect(tourist).toHaveURL(/\/m\/.+\/carta\?lang=en$/);
  await expect(tourist.getByRole("heading", { level: 1, name: "Menu" })).toBeVisible();
  await expect(tourist.getByRole("heading", { name: "Starters" })).toBeVisible();
  await expect(tourist.getByText("Iberian ham")).toBeVisible();
  await expect(tourist.getByText("Prices in euros.")).toBeVisible();
  // Cambia a español con el selector y la elección se mantiene.
  await tourist.getByText("EN", { exact: true }).click();
  await tourist.getByRole("link", { name: "Español" }).click();
  await expect(tourist.getByRole("heading", { level: 1, name: "Carta" })).toBeVisible();
  await expect(tourist.getByText("De jamón ibérico")).toBeVisible();
  await tourist
    .getByRole("banner")
    .getByRole("link", { name: /Puerto/ })
    .click();
  await expect(tourist.getByRole("heading", { level: 1, name: "Bienvenidos al puerto" })).toBeVisible();

  // Navegador en español: español; con ?lang=en, inglés.
  const local = await (await browser.newContext({ locale: "es-ES" })).newPage();
  await local.goto(sitePath);
  await expect(local.getByRole("heading", { level: 1, name: "Bienvenidos al puerto" })).toBeVisible();
  await local.goto(`${sitePath}?lang=en`);
  await expect(local.getByRole("heading", { level: 1, name: "Welcome to the harbour" })).toBeVisible();
  await expect(local.locator("[lang=en]").first()).toBeVisible();
  // Un idioma no ofrecido muestra español.
  await local.goto(`${sitePath}?lang=de`);
  await expect(local.getByRole("heading", { level: 1, name: "Bienvenidos al puerto" })).toBeVisible();

  // Si cambia el original, la traducción aparece «por revisar».
  await page.goto(`${orgPath}/products`);
  await page.getByText("Editar Croquetas").click();
  await page.locator("details", { hasText: "Editar Croquetas" }).getByLabel("Descripción (opcional)").fill("Caseras");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible();
  await page.goto(estUrl);
  await page.getByRole("link", { name: "Gestionar cartas" }).click();
  await page.getByRole("link", { name: "Carta", exact: true }).click();
  await openTab(page, "Traducciones");
  await expect(page.getByText("2 traducidos · 1 por revisar · 0 sin traducir")).toBeVisible();
  await expect(page.getByText("Revisar: el original ha cambiado")).toBeVisible();
});
