import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createOrganization, navLink, register, suffix } from "./helpers";

// Exportaciones a CSV (D-058): desde «Exportar datos», con comprobación de origen.
test("exportar datos: descarga de turnos en CSV y rechazo de peticiones de otro origen", async ({ page }) => {
  test.setTimeout(90_000);
  await register(page, "Exportar");
  const org = await createOrganization(page, "Casa Exportar", "advanced");
  await page.getByLabel("Nombre").fill("Centro");
  await page.getByLabel("Identificador (URL)").fill(`centro-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Centro" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Un turno de madrugada.
  await page.goto(`${org}/staff`);
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Añadir persona" }) });
  await add.getByLabel("Nombre").fill("Lucía");
  await add.getByLabel("Puesto (opcional)").fill("Sala");
  await add.getByRole("button", { name: "Añadir persona" }).click();
  await expect(page.getByRole("cell", { name: "Lucía", exact: true })).toBeVisible();
  await page.goto(`${est}/staff?week=2030-06-17`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Añadir turno" }) });
  await form.getByLabel("Persona").selectOption({ label: "Lucía (Sala)" });
  await form.getByLabel("Día").fill("2030-06-21");
  await form.getByLabel("De", { exact: true }).fill("20:00");
  await form.getByLabel("A", { exact: true }).fill("02:00");
  await form.getByRole("button", { name: "Añadir turno" }).click();
  await expect(page.getByText("Turno añadido")).toBeVisible();

  // En Avanzado: reservas, mensajes y turnos; el inventario es de PRO.
  await (await navLink(page, "Exportar datos")).click();
  await expect(page.getByRole("heading", { level: 2, name: "Exportar datos" })).toBeVisible();
  for (const title of ["Reservas", "Mensajes de la web", "Turnos"]) {
    await expect(page.getByRole("heading", { level: 3, name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Stock actual" })).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations,
  ).toEqual([]);

  const shifts = page.getByRole("region", { name: "Turnos" });
  await shifts.getByLabel("Desde").fill("2030-06-01");
  await shifts.getByLabel("Hasta").fill("2030-06-30");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    shifts.getByRole("button", { name: "Descargar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^turnos-centro-[0-9a-f]+-2030-06-01_2030-06-30\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.replace(/^﻿/, "").split("\r\n")).toEqual([
    "Local;Persona;Puesto;Fecha;De;A;Horas;Notas",
    "Centro;Lucía;Sala;2030-06-21;20:00;02:00;6;",
    "",
  ]);

  // Otro origen: rechazado aunque lleve la cookie de sesión.
  const kind = `${new URL(org).pathname}/exports/shifts`;
  const evil = await page.request.post(kind, {
    headers: { Origin: "https://evil.example" },
    form: { from: "2030-06-01", to: "2030-06-30" },
  });
  expect(evil.status()).toBe(403);
  // Tipo desconocido: 404.
  const unknown = await page.request.post(`${new URL(org).pathname}/exports/users`, {
    headers: { Origin: new URL(org).origin },
    form: {},
  });
  expect(unknown.status()).toBe(404);
});
