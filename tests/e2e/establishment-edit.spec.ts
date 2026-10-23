import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

test("editar los datos del local y guardar más de dos turnos sin perderlos", async ({ page }) => {
  await register(page, "Datos Local");
  await createOrganization(page, "Casa Datos");
  await page.getByLabel("Nombre").fill("Local Viejo");
  await page.getByLabel("Identificador (URL)").fill(`viejo-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Viejo" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);

  await openTab(page, "Datos del local");
  await page.getByLabel("Nombre", { exact: true }).fill("Local Nuevo");
  await page.getByLabel("Dirección").fill("Calle Mayor 1, Madrid");
  await page.getByLabel("Zona horaria").fill("Atlantic/Canary");
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Local Nuevo" })).toBeVisible();
  await expect(page.getByText(/Atlantic\/Canary · Calle Mayor 1, Madrid/)).toBeVisible();

  // Zona horaria inexistente: error del servidor, sin cambios.
  await page.reload();
  await page.getByLabel("Zona horaria").fill("Marte/Olympus");
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByText("Zona horaria no válida")).toBeVisible();

  // Tres turnos el lunes: el tercer hueco aparece tras guardar dos y no se pierde al volver a guardar.
  await openTab(page, "Horario");
  const turno = (n: number, kind: "apertura" | "cierre") => page.getByLabel(`Lunes, turno ${n}, ${kind}`);
  await turno(1, "apertura").fill("09:00");
  await turno(1, "cierre").fill("11:00");
  await turno(2, "apertura").fill("13:00");
  await turno(2, "cierre").fill("16:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await page.reload();
  await turno(3, "apertura").fill("20:00");
  await turno(3, "cierre").fill("23:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await page.reload();
  await expect(turno(3, "apertura")).toHaveValue("20:00");
  await expect(turno(4, "apertura")).toHaveValue("");
  // Guardar sin tocar nada conserva los tres turnos.
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await page.reload();
  await expect(turno(1, "apertura")).toHaveValue("09:00");
  await expect(turno(3, "cierre")).toHaveValue("23:00");
});
