import { expect, test } from "@playwright/test";
import { openTab, register, setSitePublished, suffix } from "./helpers";

test("fuera de carta: se añade en el panel y sale al momento en la carta y la web", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await register(page, "Sugerencias");
  const orgSlug = `sugerencias-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Sugerencias");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Sugerencias" })).toBeVisible();
  const org = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  for (const [name, price] of [
    ["Croquetas", "9"],
    ["Rodaballo", "28"],
  ]) {
    await page.goto(`${org}/products`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
    await form.getByLabel("Nombre").fill(name!);
    await form.getByLabel("Precio (€)").fill(price!);
    await form.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.locator("ul.cards").getByText(name!, { exact: true })).toBeVisible();
  }
  await page.goto(`${est}/menus`);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.waitForURL(/\/menus\/[0-9a-f-]+/);
  await page.getByPlaceholder("Nueva categoría").fill("Entrantes");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByLabel("Producto para Entrantes").selectOption({ label: "Croquetas (9,00 €)" });
  await page.getByRole("button", { name: "Añadir a Entrantes" }).click();
  await expect(page.getByRole("button", { name: "Quitar Croquetas" })).toBeVisible();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();
  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Carta destacada").selectOption({ label: "Carta" });
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);

  // Rodaballo solo hoy, a precio especial. Sin volver a publicar la carta.
  await page.goto(`${est}/menus`);
  await expect(page.getByText("No hay platos fuera de carta.")).toBeVisible();
  await page.getByText("Añadir plato fuera de carta").click();
  await page.getByLabel("Plato").selectOption({ label: "Rodaballo (28,00 €)" });
  await page.getByLabel("Precio especial (€, opcional)").fill("25,50");
  await page.getByLabel("Solo hoy").check();
  await page.getByRole("button", { name: "Añadir fuera de carta" }).click();
  await expect(page.getByText("Añadido fuera de carta")).toBeVisible();
  const item = page.locator("li", { hasText: "Rodaballo" });
  await expect(item.getByText("Visible hoy")).toBeVisible();
  await expect(item.getByText(/^Solo el \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  // Ya no se ofrece para añadirlo otra vez.
  await expect(page.getByLabel("Plato").locator("option", { hasText: "Rodaballo" })).toHaveCount(0);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/m/${orgSlug}/puerto/carta`);
  const special = visitor.locator("section", { has: visitor.getByRole("heading", { name: "Fuera de carta" }) });
  await expect(special.getByRole("heading", { name: "Rodaballo" })).toBeVisible();
  await expect(special.getByText("25,50 €")).toBeVisible();
  await visitor.goto(`/${orgSlug}/puerto`);
  await expect(visitor.getByRole("tab", { name: "Fuera de carta" })).toBeVisible();

  // Quitarlo lo retira al momento.
  await page.getByRole("button", { name: "Quitar Rodaballo de fuera de carta" }).click();
  await expect(page.getByText("No hay platos fuera de carta.")).toBeVisible();
  await visitor.goto(`/m/${orgSlug}/puerto/carta`);
  await expect(visitor.getByRole("heading", { name: "Fuera de carta" })).toHaveCount(0);
  await expect(visitor.getByRole("heading", { name: "Croquetas" })).toBeVisible();
});
