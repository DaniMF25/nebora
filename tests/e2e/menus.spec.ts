import { expect, test, type Page } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

async function createProduct(page: Page, name: string, price: string, allergens: string[] = []) {
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill(name);
  await form.getByLabel("Precio (€)").fill(price);
  for (const a of allergens) await form.getByLabel(a, { exact: true }).check();
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.locator("ul.cards").getByText(name, { exact: true })).toBeVisible();
}

test("crear, publicar y versionar una carta; los borradores no son públicos", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Cartas");
  await createOrganization(page, "Casa Cartas");
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Local Puerto");
  await page.getByLabel("Identificador (URL)").fill(`puerto-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  await page.getByRole("link", { name: "Productos" }).click();
  await createProduct(page, "Croquetas de jamón", "8,50", ["Gluten", "Lácteos"]);
  await createProduct(page, "Arroz a banda", "16", ["Pescado", "Moluscos"]);

  await page.goto(orgPath);
  await page.getByRole("link", { name: "Local Puerto" }).click();
  await openTab(page, /^Cartas/);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta de verano");
  await page.getByLabel("Identificador de la carta (URL)").fill("verano");
  await page.getByLabel("Tema").selectOption("mediterraneo");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await expect(page.getByRole("heading", { name: "Carta de verano" })).toBeVisible();
  await expect(page.getByText("Sin publicar", { exact: true })).toBeVisible();

  for (const name of ["Entrantes", "Arroces"]) {
    await page.getByPlaceholder("Nueva categoría").fill(name);
    await page.getByRole("button", { name: "Añadir categoría" }).click();
    await expect(page.getByRole("heading", { name, level: 4 })).toBeVisible();
  }
  await page.getByLabel("Producto para Entrantes").selectOption({ label: "Croquetas de jamón (8,50 €)" });
  await page.getByRole("button", { name: "Añadir a Entrantes" }).click();
  await expect(page.getByRole("button", { name: "Quitar Croquetas de jamón" })).toBeVisible();
  await page.getByLabel("Producto para Arroces").selectOption({ label: "Arroz a banda (16,00 €)" });
  await page.getByLabel("Precio específico (opcional)").last().fill("17,50");
  await page.getByRole("button", { name: "Añadir a Arroces" }).click();
  await expect(page.getByText("precio de catálogo 16,00 €")).toBeVisible();

  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText("Publicada la versión 1")).toBeVisible();
  const publicHref = await page.getByRole("link", { name: "Ver página pública" }).getAttribute("href");
  expect(publicHref).toMatch(/^\/m\/[a-z0-9-]+\/[a-z0-9-]+\/verano$/);

  // Visitante anónimo: ve la carta publicada.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(publicHref!);
  await expect(visitor.getByRole("heading", { name: "Carta de verano" })).toBeVisible();
  await expect(visitor.getByText("Croquetas de jamón")).toBeVisible();
  await expect(visitor.getByText("17,50 €")).toBeVisible();
  await expect(visitor.getByText("Moluscos")).toBeVisible();

  // Cambios en el borrador no aparecen hasta volver a publicar.
  await openTab(page, "Contenido");
  await page.getByPlaceholder("Nueva categoría").fill("Postres secretos");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await expect(page.getByRole("heading", { name: "Postres secretos" })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText("Postres secretos")).toHaveCount(0);
  // Y el borrador incompleto no se puede publicar (con aviso de cambios pendientes en la cabecera).
  await expect(page.getByRole("link", { name: "Ir a publicación" })).toBeVisible();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.locator(".alert").getByText("No se puede publicar la carta")).toBeVisible();

  // Vista previa del borrador: solo con sesión.
  await page.getByRole("link", { name: "Vista previa del borrador" }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByRole("heading", { name: "Postres secretos", level: 2 })).toBeVisible();
  const previewUrl = page.url();
  const anonPreview = await visitor.goto(previewUrl);
  await expect(visitor).toHaveURL(/\/login$/);
  expect(anonPreview?.ok()).toBe(true);

  // Otro restaurante no ve el editor ni la vista previa.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Competencia");
  const res = await other.goto(previewUrl);
  expect(res?.status()).toBe(404);
  await expect(other.getByText("Postres secretos")).toHaveCount(0);

  // Despublicar retira la página pública.
  await page.goBack();
  await page.getByRole("button", { name: "Despublicar" }).click();
  await expect(page.getByText("Sin publicar", { exact: true })).toBeVisible();
  const gone = await visitor.goto(publicHref!);
  expect(gone?.status()).toBe(404);

  await ctx.close();
  await anon.close();
  await otherCtx.close();
});
