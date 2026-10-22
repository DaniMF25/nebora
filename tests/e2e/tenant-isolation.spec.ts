import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "contraseña-e2e-suficientemente-larga";

function suffix() {
  return randomBytes(4).toString("hex");
}

async function register(page: Page, name: string): Promise<string> {
  const email = `${name}-${suffix()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

async function createOrganization(page: Page, name: string): Promise<string> {
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Identificador (URL)").fill(`${name.toLowerCase().replace(/\s+/g, "-")}-${suffix()}`);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

test("una ruta privada sin sesión redirige al login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("la respuesta incluye cabeceras de seguridad y la cookie de sesión es HttpOnly", async ({ page, context }) => {
  const res = await page.goto("/login");
  const headers = res!.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();

  await register(page, "Cookie");
  const cookie = (await context.cookies()).find((c) => c.name.includes("nebora_session"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});

test("el restaurante B no puede ver la organización ni los locales del restaurante A", async ({ browser }) => {
  const alice = await browser.newContext();
  const pageA = await alice.newPage();
  await register(pageA, "Alicia");
  const orgAUrl = await createOrganization(pageA, "Restaurante A");

  await pageA.getByLabel("Nombre").fill("Local secreto A");
  await pageA.getByLabel("Identificador (URL)").fill(`local-a-${suffix()}`);
  await pageA.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(pageA.getByText("Local secreto A")).toBeVisible();

  const bob = await browser.newContext();
  const pageB = await bob.newPage();
  await register(pageB, "Bruno");
  await createOrganization(pageB, "Restaurante B");

  // B conoce la URL (id) de la organización A, pero el servidor no revela nada.
  const res = await pageB.goto(orgAUrl);
  expect(res?.status()).toBe(404);
  await expect(pageB.getByText("Local secreto A")).toHaveCount(0);
  await expect(pageB.getByText("Restaurante A")).toHaveCount(0);

  // Y su listado de organizaciones solo contiene la suya.
  await pageB.goto("/app");
  await expect(pageB.getByRole("link", { name: "Restaurante B" })).toBeVisible();
  await expect(pageB.getByRole("link", { name: "Restaurante A" })).toHaveCount(0);

  await alice.close();
  await bob.close();
});

test("cerrar sesión revoca el acceso", async ({ page }) => {
  await register(page, "Salida");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});
