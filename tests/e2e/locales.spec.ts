import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

test("varios locales: selector de local, inventario y compras por local, y vista del grupo", async ({ page }) => {
  await register(page, "Grupo");
  await createOrganization(page, "Grupo Dos Locales");
  for (const name of ["Centro", "Playa"]) {
    await page.getByLabel("Nombre").fill(name);
    await page.getByLabel("Identificador (URL)").fill(`${name.toLowerCase()}-${suffix()}`);
    await page.getByRole("button", { name: "Crear establecimiento" }).click();
    await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  const local = (name: string) => nav.getByRole("group", { name: `Local: ${name}` });

  // Catálogo común y vistas del grupo, además del bloque del local.
  for (const name of ["Productos", "Ingredientes", "Proveedores", "Inventario del grupo", "Compras del grupo"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }

  // Cambiar al local Playa desde el selector y crear un almacén en su inventario.
  await nav.getByText("Local", { exact: true }).click();
  await nav.getByRole("list", { name: "Cambiar de local" }).getByRole("link", { name: "Playa" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Playa" })).toBeVisible();
  await expect(local("Playa")).toBeVisible();
  await local("Playa").getByRole("link", { name: "Inventario" }).click();
  await openTab(page, "Almacenes");
  await page.getByText("Nuevo almacén").click();
  await page.getByLabel("Nombre del almacén").fill("Bodega de la playa");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /^Bodega de la playa$/ })).toBeVisible();

  // El último local visitado se mantiene en las páginas comunes.
  await nav.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(local("Playa")).toBeVisible();
  await page.reload();
  await expect(local("Playa")).toBeVisible();

  // Centro no ve el almacén de Playa.
  await nav.getByText("Local", { exact: true }).click();
  await nav.getByRole("list", { name: "Cambiar de local" }).getByRole("link", { name: "Centro" }).click();
  await local("Centro").getByRole("link", { name: "Inventario" }).click();
  await openTab(page, "Almacenes");
  await expect(page.getByText("No hay almacenes.")).toBeVisible();
  await expect(page.getByText("Bodega de la playa")).toHaveCount(0);
  await local("Centro").getByRole("link", { name: "Compras" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Compras" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear un almacén" })).toBeVisible();

  // La vista del grupo reúne los almacenes de todos los locales.
  await nav.getByRole("link", { name: "Inventario del grupo" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Inventario del grupo" })).toBeVisible();
  await openTab(page, "Almacenes");
  await expect(page.getByRole("listitem").filter({ hasText: "Playa · Bodega de la playa" })).toBeVisible();
});

test("producto disponible solo en un local: solo lo ofrecen las cartas de ese local", async ({ page }) => {
  await register(page, "Disponible");
  const orgUrl = await createOrganization(page, "Grupo Productos");
  for (const name of ["Centro", "Playa"]) {
    await page.getByLabel("Nombre").fill(name);
    await page.getByLabel("Identificador (URL)").fill(`${name.toLowerCase()}-${suffix()}`);
    await page.getByRole("button", { name: "Crear establecimiento" }).click();
    await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  await nav.getByRole("link", { name: "Productos", exact: true }).click();
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Paella de marisco");
  await form.getByLabel("Precio (€)").fill("19");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await page.getByRole("link", { name: "Paella de marisco", exact: true }).click();
  await expect(page.getByText("Disponible en: todos los locales")).toBeVisible();
  await page.getByLabel("Solo estos locales:").check();
  await page.getByLabel("Playa", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar locales" }).click();
  await expect(page.getByText("Locales guardados")).toBeVisible();
  await expect(page.getByText("Disponible en: Playa")).toBeVisible();
  await nav.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page.getByText("solo en Playa")).toBeVisible();

  for (const [local, offered] of [
    ["Centro", false],
    ["Playa", true],
  ] as const) {
    await page.goto(orgUrl);
    await page.getByRole("main").getByRole("link", { name: local }).click();
    await page.getByRole("link", { name: "Gestionar cartas" }).click();
    await page.getByText("Nueva carta").click();
    await page.getByLabel("Nombre de la carta").fill(`Carta ${local}`);
    await page.getByLabel("Identificador de la carta (URL)").fill("carta");
    await page.getByRole("button", { name: "Crear carta" }).click();
    await page.getByPlaceholder("Nueva categoría").fill("Arroces");
    await page.getByRole("button", { name: "Añadir categoría" }).click();
    if (offered) {
      await page.getByRole("button", { name: "Añadir a Arroces" }).click();
      await expect(page.getByRole("button", { name: "Quitar Paella de marisco" })).toBeVisible();
    } else {
      await expect(page.getByText("No quedan productos disponibles en este local")).toBeVisible();
    }
  }
});
