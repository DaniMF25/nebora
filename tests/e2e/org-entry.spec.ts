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
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Nombre del negocio").fill("Casa Pepé");
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Pepé" })).toBeVisible();
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

  await page.getByRole("link", { name: "Cambiar de organización" }).click();
  await expect(page).toHaveURL(/\/app\?elegir$/);
  const cards = page.getByRole("list").filter({ has: page.getByRole("link", { name: /Casa Pepé/ }) });
  await expect(cards.getByRole("link", { name: /Casa Pepé/ })).toContainText("Propietario · 0 locales");
  await expect(cards.getByRole("link", { name: /Casa Pepé/ })).toContainText("Básico");
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
});
