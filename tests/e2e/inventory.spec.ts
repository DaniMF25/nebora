import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

test("inventario: entradas, consumos, stock insuficiente, anulación y aislamiento", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Almacen");
  await createOrganization(page, "Casa Stock");
  await page.getByLabel("Nombre").fill("Local Stock");
  await page.getByLabel("Identificador (URL)").fill(`stock-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(page.getByRole("link", { name: "Local Stock" })).toBeVisible();

  // Los ingredientes son un catálogo común; el stock va por local.
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  await nav.getByRole("link", { name: "Inventario", exact: true }).click();
  await expect(page.getByText("Necesitas al menos un almacén y un ingrediente")).toBeVisible();
  await nav.getByRole("link", { name: "Ingredientes" }).click();
  await page.getByText("Nuevo ingrediente").click();
  await page.getByLabel("Nombre del ingrediente").fill("Harina");
  await page.getByLabel("Nivel mínimo en unidad base (opcional)").fill("1000");
  await page.getByRole("button", { name: "Crear ingrediente" }).click();
  await expect(page.getByRole("button", { name: "Archivar Harina" })).toBeVisible();
  await nav.getByRole("link", { name: "Inventario", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Inventario" })).toBeVisible();
  await openTab(page, "Almacenes");
  await page.getByText("Nuevo almacén").click();
  await page.getByLabel("Nombre del almacén").fill("Cámara");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /^Cámara$/ })).toBeVisible();

  await openTab(page, "Stock");
  const movementForm = page.locator("section", { has: page.getByRole("heading", { name: "Registrar movimiento" }) });
  async function registerMovement(kind: string, quantity: string, unit: string) {
    await movementForm.getByLabel("Tipo").selectOption(kind);
    await movementForm.getByLabel("Cantidad").fill(quantity);
    await movementForm.getByLabel("Unidad").selectOption(unit);
    await movementForm.getByRole("button", { name: "Registrar movimiento" }).click();
  }

  await registerMovement("receipt", "2", "kg");
  await expect(movementForm.getByText("Movimiento registrado")).toBeVisible();
  const stockTable = page.locator("section", { has: page.getByRole("heading", { name: "Stock" }) });
  await expect(stockTable.getByRole("row", { name: /Harina/ })).toContainText("2 kg");

  await registerMovement("consumption", "1500", "g");
  await expect(stockTable.getByRole("row", { name: /Harina/ })).toContainText("500 g");
  await expect(stockTable.getByRole("row", { name: /Harina/ })).toContainText("Bajo mínimo");

  await registerMovement("consumption", "1", "kg");
  await expect(movementForm.getByText("Stock insuficiente para este movimiento")).toBeVisible();
  await registerMovement("receipt", "1", "l");
  await expect(movementForm.getByText(/unidad no es compatible/)).toBeVisible();
  await expect(stockTable.getByRole("row", { name: /Harina/ })).toContainText("500 g");

  // Anular el consumo devuelve el stock con un movimiento compensatorio.
  await openTab(page, "Movimientos");
  const consumptionRow = page.getByRole("row", { name: /Consumo/ });
  await consumptionRow.getByRole("button", { name: "Anular" }).click();
  await expect(page.getByRole("row", { name: /Corrección/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Consumo/ })).toContainText("(anulado)");
  await openTab(page, "Stock");
  await expect(stockTable.getByRole("row", { name: /Harina/ })).toContainText("2 kg");
  const inventoryUrl = page.url();

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Espia");
  const res = await other.goto(inventoryUrl);
  expect(res?.status()).toBe(404);
  await expect(other.getByText("Harina")).toHaveCount(0);

  await ctx.close();
  await otherCtx.close();
});
