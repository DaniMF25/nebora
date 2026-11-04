import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedShowcase } from "./showcase";

/**
 * Accesibilidad automática (WCAG 2.2 A y AA) con axe-core en todas las
 * páginas del panel y de la web pública, con datos reales, en escritorio y en
 * móvil. axe detecta en torno a un tercio de los problemas de WCAG (contraste,
 * nombres accesibles, etiquetas, estructura, ARIA); el resto (orden de lectura,
 * sentido de los textos, uso real con lector de pantalla) requiere revisión manual.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function axeViolations(page: Page): Promise<string[]> {
  // Desplegables abiertos: su contenido también se revisa.
  await page.evaluate(() =>
    document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n      ${v.nodes
        .slice(0, 5)
        .map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`)
        .join("\n      ")}`,
  );
}

test("accesibilidad: sin violaciones de WCAG 2.2 AA detectables en el panel y la web", async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const { est, orgSlug, pages } = await seedShowcase(page, browser);

  // Teclado: el primer Tab llega a «Saltar al contenido» y Enter lleva el foco al contenido (WCAG 2.4.1).
  for (const url of [est, `/${orgSlug}/puerto/contacto`]) {
    await page.goto(url);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    // El siguiente Tab sigue dentro del contenido, no en la barra lateral ni en la cabecera.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main")))).toBe(true);
  }

  const problems: string[] = [];
  const anonymous = await (await browser.newContext()).newPage();
  for (const url of ["/login", "/register"]) {
    await anonymous.goto(url);
    for (const v of await axeViolations(anonymous)) problems.push(`${url}: ${v}`);
  }
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const url of pages) {
      await page.goto(url);
      const where = `${viewport.width}px ${new URL(page.url()).pathname}${new URL(page.url()).search}`;
      for (const v of await axeViolations(page)) problems.push(`${where}: ${v}`);
    }
  }

  // La web en los demás estilos (el recorrido usa Mediterráneo, el de por defecto).
  const publicPages = pages.filter((u) => !u.startsWith("/app/"));
  for (const theme of ["Clásico", "Futurista", "Moderno"]) {
    await page.goto(`${est}/site?tab=estilo`);
    const card = page.getByRole("article", { name: `Estilo ${theme}` });
    await card.getByRole("button", { name: `Usar ${theme}` }).click();
    await expect(card.getByText("Actual")).toBeVisible();
    // Solo en móvil: los colores no cambian con el ancho y así la prueba dura menos.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of publicPages) {
      await page.goto(url);
      for (const v of await axeViolations(page)) problems.push(`${theme} ${url}: ${v}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
