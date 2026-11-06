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

// Web pública de Nébora (D-063, D-064) y prueba gratuita (D-062).
test("web pública: escaparate con capturas reales, recorrido, precios y entrada al panel", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Menos papeles y más servicio en tu restaurante.");
  await expect(page.getByRole("heading", { level: 2, name: "Pruébalo con tu restaurante, no con uno de ejemplo" })).toBeVisible();
  // Precios desde la única fuente (src/lib/plans.ts).
  const plans = page.locator("section", { has: page.getByRole("heading", { level: 2, name: /Tres planes/ }) });
  await expect(plans.getByRole("region", { name: "Básico" })).toContainText("Gratis");
  await expect(plans.getByRole("region", { name: "Avanzado" })).toContainText("29 €");
  await expect(plans.getByRole("region", { name: "PRO" })).toContainText("59 €");

  // Las capturas del panel y de la web cargan de verdad.
  const broken = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>("main img")];
    for (const img of imgs) {
      img.loading = "eager";
      await img.decode().catch(() => undefined);
    }
    return imgs.filter((i) => i.naturalWidth === 0).map((i) => i.src);
  });
  expect(broken).toEqual([]);

  // Recorrido por el panel: pestañas con ratón y con teclado.
  const tour = page.getByRole("tablist", { name: "Secciones del panel" });
  await expect(tour.getByRole("tab", { name: "Reservas" })).toHaveAttribute("aria-selected", "true");
  await tour.getByRole("tab", { name: "Escandallos" }).click();
  await expect(page.getByRole("tabpanel", { name: "Escandallos" })).toContainText("3,01 €");
  await expect(page.getByRole("img", { name: /Escandallo de croquetas/ })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tour.getByRole("tab", { name: "Inventario" })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Inventario" })).toBeVisible();
  // Elegida una pestaña, ya no avanza sola.
  await page.waitForTimeout(7500);
  await expect(tour.getByRole("tab", { name: "Inventario" })).toHaveAttribute("aria-selected", "true");
  await check(page);

  // Precios con la comparativa.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Precios" }).click();
  await expect(page).toHaveURL(/\/precios$/);
  await expect(page.getByRole("heading", { level: 1, name: "Precios" })).toBeVisible();
  const row = page.getByRole("row", { name: /Inventario por almacén/ });
  await expect(row.getByRole("cell")).toHaveText(["— No incluido", "— No incluido", "✓ Incluido"]);
  await check(page);

  // «Iniciar sesión» lleva al acceso y desde allí se vuelve a la web.
  await page.getByRole("link", { name: "Iniciar sesión" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Conoce Nébora" }).click();
  await expect(page).toHaveURL(/\/$/);

  // La llamada principal lleva al alta, que recuerda la prueba.
  await page.getByRole("banner").getByRole("link", { name: "Probar gratis" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText("7 días gratis del plan PRO")).toBeVisible();

  // Con sesión, la web lleva al panel.
  await register(page, "Escaparate");
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Iniciar sesión" })).toBeHidden();
  await page.getByRole("banner").getByRole("link", { name: "Ir al panel" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
