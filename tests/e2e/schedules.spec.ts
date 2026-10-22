import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("configurar horario semanal y una excepción; otro restaurante no puede verlo", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const page = await ctxA.newPage();
  await register(page, "Horarios");
  await createOrganization(page, "Casa Horarios");
  await page.getByLabel("Nombre").fill("Local Centro");
  await page.getByLabel("Identificador (URL)").fill(`centro-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Centro" }).click();
  await expect(page.getByRole("heading", { name: "Local Centro" })).toBeVisible();
  await expect(page.getByText("Sin horario de apertura configurado")).toBeVisible();

  for (let day = 1; day <= 7; day++) {
    const label = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1];
    await page.getByLabel(`${label}, turno 1, apertura`).fill("13:00");
    await page.getByLabel(`${label}, turno 1, cierre`).fill("16:00");
  }
  await page.getByLabel("Sábado, turno 2, apertura").fill("20:00");
  await page.getByLabel("Sábado, turno 2, cierre").fill("02:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sábado, turno 2, cierre")).toHaveValue("02:00");
  await expect(page.getByRole("heading", { name: "Próximos 7 días" })).toBeVisible();
  await expect(page.getByText("Sin horario de apertura configurado")).toHaveCount(0);

  // Un turno solapado se rechaza con un mensaje claro.
  await page.getByLabel("Lunes, turno 2, apertura").fill("15:00");
  await page.getByLabel("Lunes, turno 2, cierre").fill("17:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Hay turnos que se solapan")).toBeVisible();

  await page.getByLabel("Fecha").fill("2030-12-25");
  await page.getByLabel("Cerrado todo el día").check();
  await page.getByLabel("Nota (opcional)").fill("Navidad");
  await page.getByRole("button", { name: "Guardar excepción" }).click();
  await expect(page.getByRole("button", { name: "Eliminar excepción del 2030-12-25" })).toBeVisible();
  await expect(page.getByText("Navidad")).toBeVisible();
  const estUrl = page.url();

  const ctxB = await browser.newContext();
  const other = await ctxB.newPage();
  await register(other, "Ajeno");
  const res = await other.goto(estUrl);
  expect(res?.status()).toBe(404);
  await expect(other.getByText("Local Centro")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
