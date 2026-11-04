import { expect, test, type Page } from "@playwright/test";
import { createOrganization, quickLink, register, suffix } from "./helpers";

const section = (page: Page, heading: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });

// Personal y cuadrante de turnos (D-045).
test("personal y turnos: fichas, cuadrante semanal, solapes, madrugada y copiar semana", async ({ page }) => {
  test.setTimeout(90_000);
  await register(page, "Turnos");
  const org = await createOrganization(page, "Casa Turnos");
  await page.getByLabel("Nombre").fill("Centro");
  await page.getByLabel("Identificador (URL)").fill(`centro-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Centro" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Sin personal, el cuadrante remite a la página de Personal.
  await quickLink(page, "Turnos").click();
  await expect(page.getByText("Para hacer el cuadrante, añade primero a tu equipo")).toBeVisible();

  await page.goto(`${org}/staff`);
  const add = section(page, "Añadir persona");
  for (const [name, position] of [
    ["Lucía", "Sala"],
    ["Mario", "Cocina"],
  ] as const) {
    await add.getByLabel("Nombre").fill(name);
    await add.getByLabel("Puesto (opcional)").fill(position);
    await add.getByRole("button", { name: "Añadir persona" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }

  // Semana del lunes 17 de junio de 2030.
  await page.goto(`${est}/staff?week=2030-06-19`);
  await expect(page.getByRole("heading", { name: "Turnos · 17 – 23 de junio de 2030" })).toBeVisible();
  const form = section(page, "Añadir turno");
  const addShift = async (who: string, date: string, start: string, end: string) => {
    await form.getByLabel("Persona").selectOption({ label: who });
    await form.getByLabel("Día").fill(date);
    await form.getByLabel("De", { exact: true }).fill(start);
    await form.getByLabel("A", { exact: true }).fill(end);
    await form.getByRole("button", { name: "Añadir turno" }).click();
  };
  await addShift("Lucía (Sala)", "2030-06-17", "10:00", "16:00");
  await expect(page.getByText("Turno añadido")).toBeVisible();
  // La misma persona a una hora que se solapa: lo impide el servidor.
  await addShift("Lucía (Sala)", "2030-06-17", "15:00", "18:00");
  await expect(page.getByText("Esa persona ya tiene un turno que se solapa con ese horario")).toBeVisible();
  // De madrugada: de 20:00 a 02:00, 6 horas.
  await addShift("Mario (Cocina)", "2030-06-21", "20:00", "02:00");
  await expect(page.getByText("Turno añadido")).toBeVisible();

  const rota = page.getByRole("table");
  const lucia = rota.getByRole("row", { name: /Lucía/ });
  await expect(lucia.getByRole("cell").nth(0)).toHaveText("10:00–16:00");
  await expect(lucia.getByRole("cell").last()).toHaveText("6 h");
  await expect(rota.getByRole("row", { name: /Mario/ }).getByRole("cell").nth(4)).toHaveText("20:00–02:00");
  await expect(page.getByText("2 turnos · 12 h en total")).toBeVisible();

  // Modificar: Lucía de 12:00 a 16:30.
  await page.getByText("Modificar turno de Lucía (10:00–16:00)").click();
  const edit = page.locator("details[open]");
  await edit.getByLabel("De", { exact: true }).fill("12:00");
  await edit.getByLabel("A", { exact: true }).fill("16:30");
  await edit.getByRole("button", { name: "Guardar turno" }).click();
  await expect(page.getByText("Turno modificado")).toBeVisible();
  await expect(lucia.getByRole("cell").last()).toHaveText("4 h 30 min");

  // Copiar a la semana siguiente.
  await page.getByRole("link", { name: "Semana siguiente →" }).click();
  await expect(page.getByRole("heading", { name: "Turnos · 24 – 30 de junio de 2030" })).toBeVisible();
  await page.getByRole("button", { name: "Copiar la semana anterior" }).click();
  await expect(page.getByText("2 turnos copiados")).toBeVisible();
  await expect(page.getByRole("row", { name: /Lucía/ }).getByRole("cell").nth(0)).toHaveText("12:00–16:30");
  // Repetir no duplica.
  await page.getByRole("button", { name: "Copiar la semana anterior" }).click();
  await expect(page.getByText("0 turnos copiados · 2 sin copiar")).toBeVisible();

  // Eliminar un turno.
  await page.getByText("Modificar turno de Mario (20:00–02:00)").click();
  await page.locator("details[open]").getByRole("button", { name: "Eliminar turno" }).click();
  // El turno desaparece con su formulario (no queda dónde mostrar el mensaje).
  await expect(page.getByText("1 turno · 4 h 30 min en total")).toBeVisible();
  await expect(page.getByText("Modificar turno de Mario")).toHaveCount(0);

  // Una persona con turnos no se elimina: se desactiva.
  await page.goto(`${org}/staff`);
  await page.getByText("Editar a Mario").click();
  await page.locator("details[open]").getByRole("button", { name: "Eliminar a Mario" }).click();
  await expect(page.getByText("Tiene turnos: desactívala en lugar de eliminarla")).toBeVisible();
  await page
    .locator("details[open]")
    .getByLabel(/^Activo/)
    .uncheck();
  await page.locator("details[open]").getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("row", { name: /Mario/ }).getByRole("cell", { name: "Desactivado" })).toBeVisible();
});
