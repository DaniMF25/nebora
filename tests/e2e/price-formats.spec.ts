import { expect, test } from "@playwright/test";
import { openTab, register, suffix } from "./helpers";

test("formatos de precio: media ración y ración en el catálogo, la carta y la página pública", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await register(page, "Formatos");
  const orgSlug = `formatos-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Formatos");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Formatos" })).toBeVisible();
  const org = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Barra");
  await page.getByLabel("Identificador (URL)").fill("barra");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Barra" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Producto con dos formatos (las filas sugeridas) y un tercero propio.
  await page.goto(`${org}/products`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Calamares");
  await form.getByLabel(/Varios formatos/).check();
  await expect(form.getByLabel("Precio (€)", { exact: true })).toHaveCount(0);
  await form.getByLabel("Formato 1, precio (€)").fill("6,50");
  await form.getByLabel("Formato 2, precio (€)").fill("11");
  await form.getByRole("button", { name: "+ Añadir formato" }).click();
  await form.getByLabel("Formato 3, nombre").fill("Para compartir");
  await form.getByLabel("Formato 3, precio (€)").fill("18");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByText("Producto creado")).toBeVisible();
  // El formulario vuelve a su estado inicial.
  await expect(form.getByLabel(/Varios formatos/)).not.toBeChecked();
  const card = page.locator("ul.cards li", { hasText: "Calamares" });
  await expect(card.getByText(/Media ración 6,50\s€ · Ración 11,00\s€ · Para compartir 18,00\s€/)).toBeVisible();
  // Al editarlo, los formatos aparecen rellenos.
  await card.getByText("Editar Calamares").click();
  await expect(card.getByLabel("Formato 3, nombre")).toHaveValue("Para compartir");

  // Formato con precio mal escrito: error claro.
  await form.getByLabel("Nombre").fill("Vino");
  await form.getByLabel(/Varios formatos/).check();
  await form.getByLabel("Formato 1, nombre").fill("Copa");
  await form.getByLabel("Formato 1, precio (€)").fill("tres");
  await form.getByLabel("Formato 2, nombre").fill("Botella");
  await form.getByLabel("Formato 2, precio (€)").fill("18");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(form.getByText("Formato 1: precio no válido (por ejemplo 12,50)")).toBeVisible();

  // En la carta, sin precio propio para ese plato.
  await page.goto(`${est}/menus`);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.waitForURL(/\/menus\/[0-9a-f-]+/);
  await page.getByPlaceholder("Nueva categoría").fill("Raciones");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByLabel("Producto para Raciones").selectOption({ label: "Calamares (desde 6,50 €)" });
  await page.getByRole("button", { name: "Añadir a Raciones" }).click();
  await expect(page.getByRole("button", { name: "Quitar Calamares" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fijar precio" })).toHaveCount(0);
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/m/${orgSlug}/barra/carta`);
  const dish = visitor.locator("li", { hasText: "Calamares" });
  for (const [label, price] of [
    ["Media ración", /6,50\s€/],
    ["Ración", /11,00\s€/],
    ["Para compartir", /18,00\s€/],
  ]) {
    const row = dish.locator("li", { hasText: label! }).filter({ hasText: price! });
    await expect(row).toHaveCount(1);
  }
});
