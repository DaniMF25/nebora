import { expect, test, type Page } from "@playwright/test";
import { choosePlan, createOrganization, register, suffix } from "./helpers";

/** Enlaces del menú lateral (D-046). */
async function navLinks(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  return (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

// Planes Básico, Avanzado y PRO (D-046).
test("planes: Básico con web, cartas y platos en la carta; Avanzado y PRO añaden secciones", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, "Planes");
  const org = await createOrganization(page, "Casa Planes", "basic");
  await page.getByLabel("Nombre").fill("Centro");
  await page.getByLabel("Identificador (URL)").fill(`centro-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Centro" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Básico: el menú solo tiene lo del plan.
  let links = await navLinks(page);
  for (const l of ["Inicio", "Resumen", "Cartas", "Web pública", "Estadísticas", "Privacidad", "Plan"]) {
    expect(links, l).toContain(l);
  }
  for (const l of ["Reservas", "Sala", "Miembros", "Turnos y horarios", "Productos", "Inventario", "Proveedores"]) {
    expect(links, l).not.toContain(l);
  }
  // Y el servidor no sirve esas páginas aunque se escriba la dirección.
  for (const path of [
    `${est}/reservations`,
    `${est}/floor`,
    `${est}/staff`,
    `${est}/inventory`,
    `${org}/members`,
    `${org}/staff`,
    `${org}/products`,
    `${org}/ingredients`,
    `${org}/suppliers`,
  ]) {
    expect((await page.goto(path))!.status(), path).toBe(404);
  }

  // Platos creados dentro de la carta.
  await page.goto(`${est}/menus`);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta de mediodía");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await expect(page.getByRole("heading", { name: "Carta de mediodía" })).toBeVisible();
  const menu = page.url();
  await page.getByPlaceholder("Nueva categoría").fill("Entrantes");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByText("Nuevo plato en Entrantes").click();
  const dish = page.locator("details[open]");
  await dish.getByLabel("Nombre").fill("Croquetas");
  await dish.getByLabel("Precio (€)").fill("9,50");
  await dish.getByLabel("Gluten", { exact: true }).check();
  await dish.getByRole("button", { name: "Crear plato" }).click();
  await expect(page.getByRole("link", { name: "Editar plato Croquetas" })).toBeVisible();
  await expect(page.getByText("9,50 €")).toBeVisible();

  // Ficha del plato: sin receta ni escandallo en Básico; vuelve a la carta.
  await page.getByRole("link", { name: "Editar plato Croquetas" }).click();
  await expect(page.getByRole("heading", { name: "Datos del plato" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Receta/ })).toHaveCount(0);
  await page.getByLabel("Precio (€)").fill("10");
  await page.getByRole("button", { name: "Guardar plato" }).click();
  await expect(page.getByText("Guardado")).toBeVisible();
  await page.getByRole("link", { name: "← Volver a la carta" }).click();
  await expect(page).toHaveURL(menu);
  await expect(page.getByText("10,00 €")).toBeVisible();

  // Avanzado: reservas, sala, miembros y turnos.
  await page.goto(org);
  await choosePlan(page, "advanced");
  await page.goto(est);
  links = await navLinks(page);
  for (const l of ["Reservas", "Sala", "Miembros", "Turnos y horarios"]) expect(links, l).toContain(l);
  for (const l of ["Productos", "Inventario", "Proveedores"]) expect(links, l).not.toContain(l);
  expect((await page.goto(`${est}/reservations`))!.status()).toBe(200);
  expect((await page.goto(`${org}/products`))!.status()).toBe(404);

  // PRO: gestión.
  await page.goto(org);
  await choosePlan(page, "pro");
  links = await navLinks(page);
  for (const l of ["Productos", "Inventario", "Proveedores"]) expect(links, l).toContain(l);
  await page
    .getByRole("navigation", { name: "Secciones de la organización" })
    .getByRole("link", { name: "Productos" })
    .click();
  await page.getByRole("link", { name: "Croquetas" }).click();
  await expect(page.getByRole("heading", { name: /Receta/ })).toBeVisible();

  // Volver a Básico (sin más miembros): el menú vuelve a ser el del Básico.
  await page.goto(org);
  await choosePlan(page, "basic");
  links = await navLinks(page);
  expect(links).not.toContain("Reservas");
  expect(links).not.toContain("Productos");
});
