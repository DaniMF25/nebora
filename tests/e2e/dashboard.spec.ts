import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("portada con resumen del día, avisos reales y navegación usable en móvil", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await register(page, "Portada");
  await createOrganization(page, "Casa Portada");
  const home = page.url();
  await page.getByLabel("Nombre").fill("Local Portada");
  await page.getByLabel("Identificador (URL)").fill(`portada-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  // En móvil la navegación está en un menú desplegable.
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  const menu = (action: "Abrir menú" | "Cerrar menú") => page.getByRole("button", { name: action }).click();
  await expect(nav).toBeHidden();
  await menu("Abrir menú");
  await expect(nav.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("group", { name: "Local Portada" }).getByRole("link", { name: "Reservas" })).toBeVisible();
  await menu("Cerrar menú");
  await expect(nav).toBeHidden();
  const today = page.getByRole("region", { name: "Hoy" });
  await expect(today.getByRole("link", { name: "Local Portada" })).toBeVisible();
  await expect(today.getByText("Cerrado")).toBeVisible(); // sin horario
  await expect(today.getByText("No quedan reservas para hoy.")).toBeVisible();
  await expect(page.getByText("Todo al día: no hay avisos pendientes.")).toBeVisible();

  // Un producto sin receta aparece como aviso con enlace a su ficha.
  await menu("Abrir menú");
  await nav.getByRole("link", { name: "Productos" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo producto" })).toBeVisible();
  await expect(nav).toBeHidden(); // el menú se cierra al navegar
  await menu("Abrir menú");
  await expect(nav.getByRole("link", { name: "Productos" })).toHaveAttribute("aria-current", "page");
  await menu("Cerrar menú");
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Tortilla");
  await form.getByLabel("Precio (€)").fill("9");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByRole("link", { name: "Tortilla", exact: true })).toBeVisible();
  await page.goto(home);
  const alerts = page.getByRole("region", { name: "Avisos" });
  await expect(alerts.getByRole("heading", { name: "Escandallos incompletos (1)" })).toBeVisible();
  await alerts.getByRole("link", { name: "Tortilla" }).click();
  await expect(page.getByRole("heading", { name: /Tortilla/ })).toBeVisible();

  // En móvil la página no se desplaza en horizontal.
  await page.goto(home);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
