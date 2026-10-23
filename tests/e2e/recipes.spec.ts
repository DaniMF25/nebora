import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("receta y escandallo: coste, alérgenos no declarados y elaboración que descuenta stock", async ({ page }) => {
  await register(page, "Cocinera");
  await createOrganization(page, "Casa Receta");
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Local Receta");
  await page.getByLabel("Identificador (URL)").fill(`receta-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(page.getByRole("link", { name: "Local Receta" })).toBeVisible();

  // Inventario: almacén e ingredientes con coste y alérgenos.
  await page.goto(`${orgPath}/inventory?tab=articulos`);
  await page.getByText("Nuevo almacén").click();
  await page.getByLabel("Nombre del almacén").fill("Cocina");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(page.getByText("Local Receta · Cocina")).toBeVisible();
  for (const [name, cost, allergen] of [
    ["Arroz", "2,40", null],
    ["Gambas", "18", "Crustáceos"],
  ] as const) {
    await page.goto(`${orgPath}/inventory?tab=articulos`);
    await page.getByText("Nuevo ingrediente").click();
    await page.getByLabel("Nombre del ingrediente").fill(name);
    await page.getByRole("button", { name: "Crear ingrediente" }).click();
    await page.getByText(`Editar ${name}`).click();
    const edit = page.locator("details", { hasText: `Editar ${name}` });
    await edit.getByLabel("Coste (€/kg)").fill(cost);
    if (allergen) await edit.getByLabel(allergen, { exact: true }).check();
    await edit.getByRole("button", { name: "Guardar" }).click();
    await expect(edit.getByText("Guardado")).toBeVisible();
  }
  await page.goto(`${orgPath}/inventory`);
  const movement = page.locator("section", { has: page.getByRole("heading", { name: "Registrar movimiento" }) });
  for (const name of ["Arroz", "Gambas"]) {
    const opt = await movement.getByLabel("Ingrediente").locator("option", { hasText: name }).getAttribute("value");
    await movement.getByLabel("Ingrediente").selectOption(opt);
    await movement.getByLabel("Cantidad").fill("1");
    await movement.locator('select[name="unit"]').selectOption("kg");
    await movement.getByRole("button", { name: "Registrar movimiento" }).click();
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Stock" }) }).getByRole("row", { name: new RegExp(name) })).toContainText("1 kg");
  }

  // Producto y receta.
  await page.goto(`${orgPath}/products`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Paella");
  await form.getByLabel("Precio (€)").fill("18");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByText("sin receta")).toBeVisible();
  await page.getByRole("link", { name: "Paella" }).click();
  await expect(page.getByText("Añade ingredientes a la receta")).toBeVisible();

  for (const [name, qty] of [["Arroz", "100"], ["Gambas", "150"]] as const) {
    const opt = await page.getByLabel("Ingrediente").locator("option", { hasText: name }).getAttribute("value");
    await page.getByLabel("Ingrediente").selectOption(opt);
    await page.getByLabel("Cantidad por ración").fill(qty);
    await page.locator('select[name="unit"]').selectOption("g");
    await page.getByRole("button", { name: "Añadir o actualizar" }).click();
    await expect(page.getByRole("button", { name: `Quitar ${name}` })).toBeVisible();
  }
  // 100 g × 2,40 €/kg + 150 g × 18 €/kg = 0,24 + 2,70 = 2,94 € → 16,3 % de 18 €.
  const kpis = page.locator("dl.kpis");
  await expect(kpis).toContainText("2,94");
  await expect(kpis).toContainText("15,06");
  await expect(kpis).toContainText("16,3 %");

  await expect(page.getByText(/La receta contiene alérgenos que el producto no declara/)).toContainText("Crustáceos");
  await page.getByRole("button", { name: "Declararlos en el producto" }).click();
  await expect(page.getByText(/no declara en la carta/)).toHaveCount(0);
  await expect(page.getByText("Alérgenos declarados en la carta: Crustáceos")).toBeVisible();

  // Dos elaboraciones seguidas, sin recargar, descuentan dos veces (la clave se renueva).
  const produce = page.locator("section", { has: page.getByRole("heading", { name: "Registrar elaboración" }) });
  const keyInput = produce.locator('input[name="idempotencyKey"]');
  for (let i = 0; i < 2; i++) {
    const before = await keyInput.inputValue();
    await produce.getByLabel("Raciones").fill("2");
    await produce.getByRole("button", { name: "Descontar del stock" }).click();
    await expect(produce.getByText("Elaboración registrada")).toBeVisible();
    await expect(keyInput).not.toHaveValue(before);
  }
  await page.goto(`${orgPath}/inventory`);
  const stock = page.locator("section", { has: page.getByRole("heading", { name: "Stock" }) });
  await expect(stock.getByRole("row", { name: /Arroz/ })).toContainText("600 g");
  await expect(stock.getByRole("row", { name: /Gambas/ })).toContainText("400 g");
});
