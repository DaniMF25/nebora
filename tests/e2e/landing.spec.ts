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

// Web pública de Nébora (D-063, D-065) y prueba gratuita (D-062).
test("web pública: portada con demos que calculan, capturas reales, precios y entrada al panel", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Más mesas llenas");
  // Precios desde la única fuente (src/lib/plans.ts), presentados como una carta.
  await expect(page.getByRole("region", { name: /Básico/ })).toContainText("14,99 €");
  await expect(page.getByRole("region", { name: /Básico/ })).toContainText("Unos 0,49 € al día");
  await expect(page.getByRole("region", { name: /Avanzado/ })).toContainText("24,99 €");
  await expect(page.getByRole("region", { name: /PRO/ })).toContainText("34,99 €");
  await expect(page.getByRole("region", { name: /PRO/ })).toContainText("Recomendado");

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

  // Plano de sala: las mesas ocupadas salen de las reservas del día.
  const hour = page.getByRole("slider", { name: "Hora" });
  await hour.focus();
  await page.keyboard.press("Home");
  await expect(page.getByText("0 mesas ocupadas")).toBeVisible();
  await expect(page.getByText(/Siguiente: 13:30, Elena Ferrer \(2\)/)).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight"); // 14:00
  await expect(page.getByText("2 mesas ocupadas")).toBeVisible();
  await expect(page.getByText(/6 comensales en sala/)).toBeVisible();

  // Escandallo: el mismo cálculo que el panel (3,01 € de coste sobre 9,50 €).
  const cost = page.locator("section", { has: page.getByRole("heading", { name: "Croquetas de jamón ibérico" }) });
  await expect(cost.getByText("31,7 %")).toBeVisible();
  await cost.getByRole("slider", { name: /Jamón ibérico/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // 50 €/kg: 45 g cuestan 2,25 €
  await expect(cost.getByText("3,10 €")).toBeVisible();
  await expect(cost.getByText("2,25 €")).toBeVisible();

  // Carta en otros idiomas.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Iberian ham croquettes")).toBeVisible();

  // Galería de capturas.
  const strip = page.getByRole("list", { name: "Capturas del panel" });
  await page.getByRole("button", { name: "Captura siguiente" }).click();
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
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
  await page.getByRole("banner").getByRole("link", { name: "Prueba 7 días" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText("7 días gratis del plan PRO")).toBeVisible();

  // Con sesión, la web lleva al panel.
  await register(page, "Escaparate");
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Iniciar sesión" })).toBeHidden();
  await page.getByRole("banner").getByRole("link", { name: "Ir al panel" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
