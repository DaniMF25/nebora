import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

const DATE = "2030-06-14";

test("privacidad: buscar, exportar y borrar los datos de un cliente", async ({ page }) => {
  await register(page, "Privacidad");
  await createOrganization(page, "Casa Privacidad");
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Local Privacidad");
  await page.getByLabel("Identificador (URL)").fill(`priv-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Privacidad" }).click();
  await page.waitForURL(/\/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  await openTab(page, "Horario");
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
    await page.getByLabel(`${day}, turno 1, apertura`).fill("20:00");
    await page.getByLabel(`${day}, turno 1, cierre`).fill("23:30");
  }
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();

  // Reserva futura sin mesa con el correo del cliente.
  const email = `ines-${suffix()}@example.test`;
  await page.goto(`${estUrl}/reservations?date=${DATE}&time=21:00&duration=90&party=2`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nueva reserva" }) });
  await form.getByLabel("Nombre del cliente").fill("Inés Prieto");
  await form.getByLabel("Correo (opcional)").fill(email);
  await form.getByRole("button", { name: "Crear reserva" }).click();
  await expect(page.getByText("Reserva creada")).toBeVisible();

  await page.goto(`${orgPath}/privacy`);
  await expect(page.getByText("Los datos personales se anonimizan")).toBeVisible();
  await page.getByLabel("Correo o teléfono del cliente").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("cell", { name: "Inés Prieto" })).toBeVisible();
  expect(page.url()).not.toContain("ines");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar datos (JSON)" }).click();
  const download = await downloadPromise;
  const json = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(json.controller).toBe("Casa Privacidad");
  expect(json.reservations).toHaveLength(1);
  expect(json.reservations[0]).toMatchObject({ name: "Inés Prieto", email });

  // Con una reserva futura activa no se borra.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Borrar datos del cliente" }).click();
  await expect(page.getByText(/reserva\(s\) futura\(s\) activa\(s\)/)).toBeVisible();

  // Se cancela la reserva y ya se puede borrar.
  await page.goto(`${estUrl}/reservations?date=${DATE}`);
  await page.getByRole("button", { name: "Cancelar (Inés Prieto)" }).click();
  await expect(page.getByText("Cancelada")).toBeVisible();
  await page.goto(`${orgPath}/privacy`);
  await page.getByLabel("Correo o teléfono del cliente").fill(email);
  await page.getByRole("button", { name: "Buscar" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Borrar datos del cliente" }).click();
  await expect(page.getByText("Datos borrados: 1 reserva(s) anonimizada(s).")).toBeVisible();

  await page.goto(`${estUrl}/reservations?date=${DATE}`);
  await expect(page.getByText("Cliente anonimizado")).toBeVisible();
  await expect(page.getByText("Inés Prieto")).toHaveCount(0);
});

test("la exportación rechaza peticiones de otro origen", async ({ page, request }) => {
  await register(page, "Origen");
  await createOrganization(page, "Casa Origen");
  const orgPath = new URL(page.url()).pathname;
  const res = await page.request.post(`${orgPath}/privacy/export`, {
    form: { contact: "a@example.test" },
    headers: { origin: "https://evil.example" },
  });
  expect(res.status()).toBe(403);
  const anon = await request.post(`${orgPath}/privacy/export`, {
    form: { contact: "a@example.test" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(anon.status()).toBe(401);
});
