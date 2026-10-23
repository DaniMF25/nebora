import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("traspaso entre almacenes y recuento físico con ajuste de diferencias", async ({ page }) => {
  await register(page, "Recuentos");
  await createOrganization(page, "Casa Recuentos");
  await page.getByLabel("Nombre").fill("Local Recuento");
  await page.getByLabel("Identificador (URL)").fill(`recuento-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(page.getByRole("link", { name: "Local Recuento" })).toBeVisible();

  await page.getByRole("link", { name: "Inventario" }).click();
  for (const name of ["Central", "Barra"]) {
    await page.getByText("Nuevo almacén").click();
    await page.getByLabel("Nombre del almacén").fill(name);
    await page.getByRole("button", { name: "Crear almacén" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: `Local Recuento · ${name}` })).toBeVisible();
    await page.reload();
  }
  await page.getByText("Nuevo ingrediente").click();
  await page.getByLabel("Nombre del ingrediente").fill("Harina");
  await page.getByRole("button", { name: "Crear ingrediente" }).click();
  await expect(page.getByRole("button", { name: "Archivar Harina" })).toBeVisible();

  const movementForm = page.locator("section", { has: page.getByRole("heading", { name: "Registrar movimiento" }) });
  await movementForm.getByLabel("Almacén").selectOption({ label: "Local Recuento · Central" });
  await movementForm.getByLabel("Cantidad").fill("10");
  await movementForm.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(movementForm.getByText("Movimiento registrado")).toBeVisible();

  // Traspaso de 4 kg a la barra.
  const transferForm = page.locator("section", {
    has: page.getByRole("heading", { name: "Traspaso entre almacenes" }),
  });
  await transferForm.getByLabel("Desde").selectOption({ label: "Local Recuento · Central" });
  await transferForm.getByLabel("Hacia").selectOption({ label: "Local Recuento · Barra" });
  await transferForm.getByLabel("Cantidad a traspasar").fill("4");
  await transferForm.getByRole("button", { name: "Registrar traspaso" }).click();
  await expect(transferForm.getByText("Traspaso registrado")).toBeVisible();
  const stock = page.locator("section", { has: page.getByRole("heading", { name: "Stock", exact: true }) });
  await expect(stock.getByRole("row", { name: /Central.*Harina/ })).toContainText("6 kg");
  await expect(stock.getByRole("row", { name: /Barra.*Harina/ })).toContainText("4 kg");
  await expect(page.getByRole("row", { name: /Traspaso \(salida\)/ })).not.toContainText("Anular");

  // Más de lo que hay: error y nada cambia.
  await transferForm.getByLabel("Cantidad a traspasar").fill("50");
  await transferForm.getByRole("button", { name: "Registrar traspaso" }).click();
  await expect(transferForm.getByText("Stock insuficiente para este movimiento")).toBeVisible();

  // Recuento de la central: hay 6 kg en sistema, se cuentan 5,5 kg.
  const countForm = page.locator("section", { has: page.getByRole("heading", { name: "Recuentos físicos" }) });
  await countForm.getByLabel("Almacén a contar").selectOption({ label: "Local Recuento · Central" });
  await countForm.getByRole("button", { name: "Empezar recuento" }).click();
  await page.waitForURL(/inventory\/counts\/[0-9a-f-]+$/);
  await expect(page.getByText(/^Abierto/)).toBeVisible();
  await expect(page.getByText("6 kg")).toHaveCount(0); // recuento ciego
  await page.getByLabel("Cantidad contada de Harina").fill("5,5");
  await page.getByRole("button", { name: "Guardar recuento" }).click();
  await expect(page.getByText("Recuento guardado")).toBeVisible();
  await page.getByRole("button", { name: "Aplicar recuento" }).click();
  await expect(page.getByText(/^Aplicado/)).toBeVisible();
  const result = page.getByRole("row", { name: /Harina/ });
  await expect(result).toContainText("5,5 kg");
  await expect(result).toContainText("6 kg");
  await expect(result).toContainText("−500 g");

  await page.getByRole("link", { name: "← Inventario" }).click();
  await expect(stock.getByRole("row", { name: /Central.*Harina/ })).toContainText("5,5 kg");
  await expect(page.getByRole("row", { name: /Recuento/ }).first()).toContainText("500 g");
});
