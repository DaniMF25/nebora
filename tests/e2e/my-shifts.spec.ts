import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createOrganization, PASSWORD, register, suffix } from "./helpers";

function madridDate(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );
}

// «Mis turnos» (D-054): quien tiene su cuenta vinculada a una ficha ve sus próximos turnos en Inicio.
test("mis turnos: el miembro con ficha ve sus próximos turnos en Inicio; el propietario sin ficha, no", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await register(page, "MisTurnos");
  const org = await createOrganization(page, "Casa Mis Turnos", "advanced");
  await page.getByLabel("Nombre").fill("Centro");
  await page.getByLabel("Identificador (URL)").fill(`centro-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Centro" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Invitación: Ana se une con su propia cuenta.
  await page.goto(`${org}/members`);
  await page.getByLabel("Correo electrónico").fill(`ana-${suffix()}@example.test`);
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const link = await page.getByLabel("Enlace de invitación").inputValue();
  const ana = await (await browser.newContext()).newPage();
  await ana.goto(link);
  await ana.getByLabel("Nombre").fill("Ana");
  await ana.getByLabel(/Contraseña/).fill(PASSWORD);
  await ana.getByRole("button", { name: "Crear cuenta y unirme" }).click();
  await expect(ana.getByRole("heading", { level: 1, name: "Casa Mis Turnos" })).toBeVisible();
  // Aún sin ficha: no hay sección de turnos propios.
  await expect(ana.getByRole("heading", { name: "Mis próximos turnos" })).toHaveCount(0);

  // Ficha vinculada y dos turnos: mañana y pasado mañana.
  await page.goto(`${org}/staff`);
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Añadir persona" }) });
  await add.getByLabel("Nombre").fill("Ana López");
  await add.getByLabel("Puesto (opcional)").fill("Sala");
  await add.getByLabel("Cuenta en Nébora (opcional)").selectOption({ label: "Ana" });
  await add.getByRole("button", { name: "Añadir persona" }).click();
  await expect(page.getByRole("cell", { name: "Ana López" })).toBeVisible();
  const tomorrow = madridDate(1);
  await page.goto(`${est}/staff?week=${tomorrow}`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Añadir turno" }) });
  for (const [date, start, end] of [
    [tomorrow, "10:00", "14:00"],
    [madridDate(2), "20:00", "02:00"],
  ] as const) {
    if (date !== tomorrow) await page.goto(`${est}/staff?week=${date}`);
    await form.getByLabel("Persona").selectOption({ label: "Ana López (Sala)" });
    await form.getByLabel("Día").fill(date);
    await form.getByLabel("De", { exact: true }).fill(start);
    await form.getByLabel("A", { exact: true }).fill(end);
    await form.getByRole("button", { name: "Añadir turno" }).click();
    await expect(page.getByText("Turno añadido")).toBeVisible();
  }

  // Ana: sus turnos en Inicio, con enlace al cuadrante de esa semana.
  await ana.reload();
  const mine = ana.locator("section", { has: ana.getByRole("heading", { name: "Mis próximos turnos" }) });
  const items = mine.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Mañana");
  await expect(items.nth(0)).toContainText("10:00–14:00");
  await expect(items.nth(0)).toContainText("Centro · Sala");
  await expect(items.nth(1)).toContainText("20:00–02:00");
  // Accesible (WCAG 2.2 AA) y sin desplazamiento horizontal en un móvil estrecho.
  for (const width of [1280, 360]) {
    await ana.setViewportSize({ width, height: 800 });
    const { violations } = await new AxeBuilder({ page: ana })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(await ana.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await items.nth(0).getByRole("link", { name: /^Ver cuadrante/ }).click();
  await expect(ana).toHaveURL(new RegExp(`/staff\\?week=${tomorrow}$`));
  await expect(ana.getByRole("table").getByRole("row", { name: /Ana López/ })).toContainText("10:00–14:00");

  // El propietario no tiene ficha: no ve la sección.
  await page.goto(org);
  await expect(page.getByRole("heading", { name: "Mis próximos turnos" })).toHaveCount(0);
});
