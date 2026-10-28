import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "contraseña-e2e-suficientemente-larga";

export function suffix(): string {
  return randomBytes(4).toString("hex");
}

export async function register(page: Page, name: string): Promise<string> {
  const local = name.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
  const email = `${local}-${suffix()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

export async function createOrganization(page: Page, name: string): Promise<string> {
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Identificador (URL)").fill(`${name.toLowerCase().replace(/\s+/g, "-")}-${suffix()}`);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

/** Abre una pestaña de la página actual del panel (enlaces `?tab=`). */
export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "Apartados de la página" }).getByRole("link", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Apartados de la página" }).getByRole("link", { name }),
  ).toHaveAttribute("aria-current", "page");
}

/**
 * Horario semanal igual todos los días: abre el lunes, rellena sus turnos y
 * los copia al resto con el editor (pestaña «Horario» ya abierta). Guarda.
 */
export async function setDailyHours(page: Page, slots: [string, string][]): Promise<void> {
  await page.getByLabel("Lunes abierto").check();
  for (const [n, [opens, closes]] of slots.entries()) {
    if (n > 0) await page.getByRole("button", { name: "Añadir turno en Lunes" }).click();
    await page.getByLabel(`Lunes, turno ${n + 1}, apertura`).fill(opens);
    await page.getByLabel(`Lunes, turno ${n + 1}, cierre`).fill(closes);
  }
  await page.getByLabel("Copiar el horario del").selectOption({ label: "lunes" });
  await page.getByLabel("Copiar a").selectOption({ label: "todos los días" });
  await page.getByRole("button", { name: "Copiar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
}

/** Publica (o retira) la web del local con el interruptor de la cabecera de «Web». */
export async function setSitePublished(page: Page, published: boolean): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Publicar la web" });
  if ((await toggle.getAttribute("aria-checked")) !== String(published)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(published));
}
