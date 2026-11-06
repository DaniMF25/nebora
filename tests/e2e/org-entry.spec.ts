import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function axe(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

// Entrada al panel (D-055): bienvenida sin organizaciones, entrada directa con una y selector con varias.
test("entrada al panel: bienvenida, entrada directa con una organización y selector con varias", async ({ page }) => {
  test.setTimeout(60_000);
  await register(page, "Entrada");

  // Sin organizaciones: bienvenida con los pasos y alta solo con el nombre.
  await expect(page.getByRole("heading", { level: 1, name: "Pon en marcha tu restaurante" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Tu primer local" })).toBeVisible();
  await expect(page.getByText("7 días gratis del plan PRO")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Nombre del negocio").fill("Casa Pepé");
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Pepé" })).toBeVisible();
  // La primera organización empieza con la prueba gratuita del PRO (D-062).
  await expect(page.getByText("Prueba gratuita del plan PRO")).toBeVisible();
  await expect(page.getByText("te quedan 7 días")).toBeVisible();
  const first = page.url();

  // Con una sola organización, /app lleva directamente a ella.
  await page.goto("/app");
  await expect(page).toHaveURL(first);

  // Desde el panel se puede crear otra; el selector la muestra con su plan y locales.
  await page.getByRole("link", { name: "Crear otra organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Elige una organización" })).toBeVisible();
  await page.getByLabel("Nombre del negocio").fill("La Viña");
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "La Viña" })).toBeVisible();
  // Una prueba por persona: la segunda nace sin plan y el panel solo deja elegirlo (D-068).
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator("main [role=alert]")).toContainText("Tu organización no tiene un plan activo");
  await expect(page.locator("main [role=alert]")).toContainText("se eliminarán la organización y todos sus datos");
  expect(await axe(page)).toEqual([]);
  // Cualquier otra página del panel lleva de vuelta a «Plan».
  await page.goto(page.url().replace(/\/plan$/, "/members"));
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("navigation", { name: "Secciones de la organización" }).getByRole("link")).toHaveText(["Plan"]);

  await page.getByRole("link", { name: "Cambiar de organización" }).click();
  await expect(page).toHaveURL(/\/app\?elegir$/);
  const cards = page.getByRole("list").filter({ has: page.getByRole("link", { name: /Casa Pepé/ }) });
  await expect(cards.getByRole("link", { name: /Casa Pepé/ })).toContainText("Propietario · 0 locales");
  await expect(cards.getByRole("link", { name: /Casa Pepé/ })).toContainText("Prueba PRO");
  await expect(cards.getByRole("link", { name: /La Viña/ })).toContainText("Sin plan");
  await expect(cards.getByRole("link", { name: /La Viña/ })).toBeVisible();
  // El formulario de otra organización queda recogido cuando ya hay varias.
  await expect(page.getByLabel("Nombre del negocio")).toBeHidden();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  // Con varias, /app muestra el selector.
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Elige una organización" })).toBeVisible();
  await cards.getByRole("link", { name: /La Viña/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "La Viña" })).toBeVisible();
  // Al activar un plan, el panel se desbloquea.
  await page.locator('input[name="plan"][value="basic"]').check();
  await page.getByRole("button", { name: "Activar el plan" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}\?plan=activado$/);
  await expect(page.getByRole("heading", { level: 1, name: "La Viña" })).toBeVisible();
  await expect(page.getByText("Tu organización no tiene un plan activo")).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});
