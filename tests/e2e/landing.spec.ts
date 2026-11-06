import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function check(page: Page): Promise<void> {
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px`).toBe(true);
  }
}

// Web pública de Nébora (D-063) y prueba gratuita (D-062).
test("web pública: escaparate con la prueba gratuita, precios y entrada al panel", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tu restaurante");
  await expect(page.getByText("7 días gratis del plan PRO · sin tarjeta")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "7 días con todo el plan PRO, gratis" })).toBeVisible();
  // Precios desde la única fuente (src/lib/plans.ts).
  const plans = page.getByRole("list").filter({ has: page.getByRole("heading", { level: 3, name: "Avanzado" }) });
  await expect(plans.getByRole("listitem").filter({ hasText: "Básico" }).first()).toContainText("Gratis");
  await expect(plans.getByText("29 €")).toBeVisible();
  await expect(plans.getByText("59 €")).toBeVisible();
  await check(page);

  // Las preguntas se abren.
  await page.getByText("¿Qué pasa cuando terminan los 7 días?").click();
  await expect(page.getByText(/pasa sola al plan Básico/)).toBeVisible();

  // Precios con la comparativa.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Precios" }).click();
  await expect(page).toHaveURL(/\/precios$/);
  await expect(page.getByRole("heading", { level: 1, name: "Planes y precios" })).toBeVisible();
  const row = page.getByRole("row", { name: /Inventario por almacén/ });
  await expect(row.getByRole("cell")).toHaveText(["— No incluido", "— No incluido", "✓ Incluido"]);
  await check(page);

  // «Iniciar sesión» lleva al acceso y desde allí se vuelve a la web.
  await page.getByRole("link", { name: "Iniciar sesión" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Conoce Nébora" }).click();
  await expect(page).toHaveURL(/\/$/);

  // La llamada principal lleva al alta, que recuerda la prueba.
  await page.getByRole("banner").getByRole("link", { name: "Prueba gratis 7 días" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText("7 días gratis del plan PRO")).toBeVisible();

  // Con sesión, la web lleva al panel.
  await register(page, "Escaparate");
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Iniciar sesión" })).toBeHidden();
  await page.getByRole("banner").getByRole("link", { name: "Ir al panel" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
