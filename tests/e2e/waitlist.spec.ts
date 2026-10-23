import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

const DATE = "2030-06-14"; // viernes futuro

test("lista de espera: apuntar, ver hueco y convertir en reserva", async ({ page }) => {
  await register(page, "Espera");
  await createOrganization(page, "Casa Espera");
  await page.getByLabel("Nombre").fill("Local Espera");
  await page.getByLabel("Identificador (URL)").fill(`espera-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Espera" }).click();
  await page.waitForURL(/\/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  await openTab(page, "Horario");
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
    await page.getByLabel(`${day}, turno 1, apertura`).fill("20:00");
    await page.getByLabel(`${day}, turno 1, cierre`).fill("23:30");
  }
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();

  await page.goto(`${estUrl}/floor`);
  await page.getByLabel("Nombre de la zona").fill("Sala");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await page.getByText("Nueva mesa en Sala").click();
  const tableForm = page.locator("details", { hasText: "Nueva mesa en Sala" });
  await tableForm.getByLabel("Nombre de la mesa").fill("T1");
  await tableForm.getByLabel("Máximo").fill("4");
  await tableForm.getByRole("button", { name: "Crear mesa" }).click();
  await expect(page.getByRole("button", { name: /^Mesa T1,/ })).toBeVisible();

  // La única mesa, ocupada de 20:00 a 21:30.
  const base = `${estUrl}/reservations`;
  await page.goto(`${base}?date=${DATE}&time=20:00&duration=90&party=4`);
  const search = page.locator("section", { has: page.getByRole("heading", { name: "Nueva reserva" }) });
  await search.getByLabel(/^T1 /).check();
  await search.getByLabel("Nombre del cliente").fill("Grupo Ocupa");
  await search.getByRole("button", { name: "Crear reserva" }).click();
  await expect(page.getByText("Reserva creada")).toBeVisible();

  // Apuntar a la lista de espera.
  const waitlist = page.locator("section", { has: page.getByRole("heading", { name: /^Lista de espera/ }) });
  await waitlist.getByText("Apuntar en lista de espera").click();
  await waitlist.getByLabel("Desde").fill("20:00");
  await waitlist.getByLabel("Hasta").fill("22:30");
  await waitlist.getByLabel("Nombre de quien espera").fill("Carmen Vidal");
  await waitlist.getByRole("button", { name: "Añadir a la lista de espera" }).click();
  await expect(waitlist.getByText("Indica un teléfono o un correo para poder avisar")).toBeVisible();
  await waitlist.getByLabel("Teléfono de contacto").fill("600 222 333");
  await waitlist.getByRole("button", { name: "Añadir a la lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera (1)" })).toBeVisible();
  await expect(waitlist.getByText("Hay mesa a las 21:30")).toBeVisible();
  await expect(waitlist.getByRole("link", { name: "600 222 333" })).toHaveAttribute("href", "tel:600222333");

  await waitlist.getByRole("button", { name: "Reservar a Carmen Vidal a las 21:30" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera (0)" })).toBeVisible();
  await expect(waitlist.getByText("Convertida en reserva")).toBeVisible();
  const list = page.locator("section", { has: page.getByRole("heading", { name: "Reservas del día" }) });
  await expect(list.getByText(/21:30–23:00 · Carmen Vidal · 2 pers\. · Mesa T1/)).toBeVisible();
});
