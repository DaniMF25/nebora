import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("compras: proveedor, pedido, recepción parcial y total que actualiza stock y coste", async ({ page }) => {
  await register(page, "Compras");
  await createOrganization(page, "Casa Compras");
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Local Compras");
  await page.getByLabel("Identificador (URL)").fill(`compras-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(page.getByRole("link", { name: "Local Compras" })).toBeVisible();

  await page.goto(`${orgPath}/inventory?tab=articulos`);
  await page.getByText("Nuevo almacén").click();
  await page.getByLabel("Nombre del almacén").fill("Despensa");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(page.getByText("Local Compras · Despensa")).toBeVisible();
  await page.getByText("Nuevo ingrediente").click();
  await page.getByLabel("Nombre del ingrediente").fill("Arroz");
  await page.getByRole("button", { name: "Crear ingrediente" }).click();
  await expect(page.getByRole("button", { name: "Archivar Arroz" })).toBeVisible();

  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await expect(page.getByText("necesitas un proveedor activo")).toBeVisible();
  await page.getByText("Nuevo proveedor").click();
  await page.getByLabel("Nombre del proveedor").fill("Distribuciones Levante");
  await page.getByLabel("Correo (opcional)").fill("pedidos@levante.example");
  await page.getByRole("button", { name: "Crear proveedor" }).click();
  await expect(page.getByRole("button", { name: "Archivar Distribuciones Levante" })).toBeVisible();

  await page.getByText("Nuevo pedido").click();
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido 1 · Distribuciones Levante" })).toBeVisible();
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  await page.getByLabel("Cantidad").fill("25");
  await page.locator('select[name="unit"]').selectOption("kg");
  await page.getByLabel("Precio (€ por kg, l o ud.)").fill("2,15");
  await page.getByRole("button", { name: "Añadir o actualizar línea" }).click();
  await expect(page.getByText("Total: 53,75 €")).toBeVisible();

  await page.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(page.getByText("Enviado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Añadir o actualizar línea" })).toHaveCount(0);

  // Recepción parcial: 10 de 25 kg.
  const receive = page.locator("section", { has: page.getByRole("heading", { name: "Registrar recepción" }) });
  await expect(receive.getByLabel(/Arroz \(pendiente 25 kg\)/)).toHaveValue("25");
  await receive.getByRole("textbox", { name: /Arroz/ }).fill("10");
  await receive.getByLabel(/albarán/).fill("Albarán 4471");
  await receive.getByRole("button", { name: "Registrar recepción" }).click();
  await expect(page.getByText("Recibido en parte", { exact: true })).toBeVisible();
  await expect(page.getByText("Albarán 4471")).toBeVisible();

  // Más de lo pendiente: rechazado.
  await expect(receive.getByLabel(/Arroz \(pendiente 15 kg\)/)).toHaveValue("15");
  await receive.getByRole("textbox", { name: /Arroz/ }).fill("16");
  await receive.getByRole("button", { name: "Registrar recepción" }).click();
  await expect(receive.getByText("No se puede recibir más de lo pendiente")).toBeVisible();

  await receive.getByRole("textbox", { name: /Arroz/ }).fill("15");
  await receive.getByRole("button", { name: "Registrar recepción" }).click();
  await expect(page.getByText("Recibido", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registrar recepción" })).toHaveCount(0);

  await page.goto(`${orgPath}/inventory`);
  const stock = page.locator("section", { has: page.getByRole("heading", { name: "Stock" }) });
  await expect(stock.getByRole("row", { name: /Arroz/ })).toContainText("25 kg");
  await page.goto(`${orgPath}/inventory?tab=articulos`);
  await expect(page.getByText("coste 2,15 € /kg")).toBeVisible();
  await page.goto(`${orgPath}/inventory?tab=movimientos`);
  await expect(page.getByRole("row", { name: /Recepción del pedido 1/ }).first()).toBeVisible();
});
