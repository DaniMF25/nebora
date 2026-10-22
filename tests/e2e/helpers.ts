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
