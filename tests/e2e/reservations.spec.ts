import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, suffix } from "./helpers";

const DATE = "2030-06-14"; // viernes futuro: evita depender de la hora actual

test("reservas: buscar mesas libres, reservar, ocupación en el plano, cancelar y horario", async ({ page, browser }) => {
  await register(page, "Reservas");
  await createOrganization(page, "Casa Reservas");
  await page.getByLabel("Nombre").fill("Local Reservas");
  await page.getByLabel("Identificador (URL)").fill(`reservas-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Reservas" }).click();
  await page.waitForURL(/\/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();

  await openTab(page, "Horario");
  // Horario: mediodía y noche todos los días.
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
    await page.getByLabel(`${day}, turno 1, apertura`).fill("13:00");
    await page.getByLabel(`${day}, turno 1, cierre`).fill("16:00");
    await page.getByLabel(`${day}, turno 2, apertura`).fill("20:00");
    await page.getByLabel(`${day}, turno 2, cierre`).fill("00:00");
  }
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();

  // Plano: una zona con dos mesas.
  await page.goto(`${estUrl}/floor`);
  await page.getByLabel("Nombre de la zona").fill("Comedor");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("group", { name: "Plano de Comedor" })).toBeVisible();
  for (const name of ["T1", "T2"]) {
    const form = page.locator("details", { hasText: "Nueva mesa en Comedor" });
    if ((await form.getAttribute("open")) === null) await page.getByText("Nueva mesa en Comedor").click();
    await form.getByLabel("Nombre de la mesa").fill(name);
    await form.getByLabel("Máximo").fill("4");
    await form.getByRole("button", { name: "Crear mesa" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^Mesa ${name},`) })).toBeVisible();
  }

  const base = `${estUrl}/reservations`;
  await page.goto(`${base}?date=${DATE}`);
  await expect(page.getByText("No hay reservas este día.")).toBeVisible();

  // Fuera de horario.
  const search = page.locator("section", { has: page.getByRole("heading", { name: "Nueva reserva" }) });
  await search.getByLabel("Hora").fill("17:30");
  await search.getByRole("button", { name: "Buscar mesas libres" }).click();
  await expect(page.getByText("El establecimiento no está abierto durante todo ese horario")).toBeVisible();

  // Buscar y reservar T1 a las 21:00.
  await search.getByLabel("Hora").fill("21:00");
  await search.getByLabel("Comensales").fill("3");
  await search.getByRole("button", { name: "Buscar mesas libres" }).click();
  await expect(search.getByText("3 personas a las 21:00 (90 min).")).toBeVisible();
  await search.getByLabel(/^T1 /).check();
  await search.getByLabel("Nombre del cliente").fill("Marta Ruiz");
  await search.getByLabel("Teléfono (opcional)").fill("600123123");
  await search.getByRole("button", { name: "Crear reserva" }).click();
  await expect(page.getByText("Reserva creada")).toBeVisible();
  const list = page.locator("section", { has: page.getByRole("heading", { name: "Reservas del día" }) });
  await expect(list.getByText(/21:00–22:30 · Marta Ruiz · 3 pers\. · Mesa T1/)).toBeVisible();

  // T1 ya no aparece libre a esa hora.
  await page.goto(`${base}?date=${DATE}&time=21:30&duration=60&party=2`);
  await expect(search.getByLabel(/^T2 /)).toBeVisible();
  await expect(search.getByLabel(/^T1 /)).toHaveCount(0);

  // Ocupación a las 22:00: T1 ocupada por Marta, T2 libre.
  await page.goto(`${base}?date=${DATE}&at=22:00`);
  const occupancy = page.getByRole("img", { name: /Ocupación de Comedor/ });
  await expect(occupancy).toHaveAttribute("aria-label", /mesa T1 ocupada por Marta Ruiz/);
  await expect(occupancy).toHaveAttribute("aria-label", /mesa T2 libre/);

  // Cancelar libera la mesa.
  await list.getByRole("button", { name: "Cancelar (Marta Ruiz)" }).click();
  await expect(list.getByText("Cancelada")).toBeVisible();
  await page.goto(`${base}?date=${DATE}&at=22:00`);
  await expect(page.getByRole("img", { name: /Ocupación de Comedor/ })).toHaveAttribute("aria-label", /mesa T1 libre/);

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Curioso");
  expect((await other.goto(`${base}?date=${DATE}`))?.status()).toBe(404);
  await expect(other.getByText("Marta Ruiz")).toHaveCount(0);
  await otherCtx.close();
});
