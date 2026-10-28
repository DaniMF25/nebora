import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

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

  await openTab(page, "Horario");
  // Sin horario, todos los días aparecen cerrados y sin campos.
  await expect(page.getByLabel("Lunes abierto")).not.toBeChecked();
  await expect(page.getByLabel("Lunes, turno 1, apertura")).toHaveCount(0);
  for (const label of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
    await page.getByLabel(`${label} abierto`).check();
    await page.getByLabel(`${label}, turno 1, apertura`).fill("13:00");
    await page.getByLabel(`${label}, turno 1, cierre`).fill("16:00");
  }
  await page.getByRole("button", { name: "Añadir turno en Sábado" }).click();
  await page.getByLabel("Sábado, turno 2, apertura").fill("20:00");
  await page.getByLabel("Sábado, turno 2, cierre").fill("02:00");
  await expect(page.getByRole("group", { name: "Sábado" }).getByText("(termina al día siguiente)")).toBeVisible();
  // El domingo cierra: al apagarlo no envía turnos.
  await page.getByLabel("Domingo abierto").uncheck();
  await expect(page.getByLabel("Domingo, turno 1, apertura")).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sábado, turno 2, cierre")).toHaveValue("02:00");
  await expect(page.getByLabel("Domingo abierto")).not.toBeChecked();
  await openTab(page, "Resumen");
  await expect(page.getByRole("heading", { name: "Próximos 7 días" })).toBeVisible();
  await expect(page.getByText("Sin horario de apertura configurado")).toHaveCount(0);
  await openTab(page, "Horario");

  // Copiar el sábado a todos los días replica sus dos turnos.
  await page.getByLabel("Copiar el horario del").selectOption({ label: "sábado" });
  await page.getByLabel("Copiar a").selectOption({ label: "todos los días" });
  await page.getByRole("button", { name: "Copiar", exact: true }).click();
  await expect(page.getByLabel("Domingo abierto")).toBeChecked();
  await expect(page.getByLabel("Martes, turno 2, cierre")).toHaveValue("02:00");
  // Quitar un turno lo elimina de ese día.
  await page.getByRole("button", { name: "Quitar turno 2 de Martes" }).click();
  await expect(page.getByLabel("Martes, turno 2, apertura")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Domingo abierto")).not.toBeChecked();

  // Un turno solapado se rechaza con un mensaje claro.
  await page.getByRole("button", { name: "Añadir turno en Lunes" }).click();
  await page.getByLabel("Lunes, turno 2, apertura").fill("15:00");
  await page.getByLabel("Lunes, turno 2, cierre").fill("17:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Hay turnos que se solapan")).toBeVisible();
  // Lo escrito sigue ahí para corregirlo.
  await expect(page.getByLabel("Lunes, turno 2, apertura")).toHaveValue("15:00");

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
