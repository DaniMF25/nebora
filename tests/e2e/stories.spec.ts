import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { choosePlan, createOrganization, openTab, register, setSitePublished, suffix } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

// Historias de la portada (D-059).
test("historias: se crean en el panel, se abren solas la primera vez y se navegan; en Básico no salen", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await register(page, "Historias");
  const org = await createOrganization(page, "Casa Historias", "advanced");
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill(`puerto-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();
  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  const home = (await page.getByRole("link", { name: "Ver página pública" }).getAttribute("href"))!;

  // Panel: dos historias, la primera con foto y botón de contacto.
  await openTab(page, "Historias");
  const create = page.getByRole("group", { name: "Nueva historia" });
  await create.getByLabel("Titular").fill("Nueva terraza");
  await create.getByLabel("Texto (opcional)").fill("Desde este viernes, cenas al aire libre.");
  await create.locator('input[name="image"]').setInputFiles({
    name: "terraza.png",
    mimeType: "image/png",
    buffer: await sharp({ create: { width: 600, height: 900, channels: 3, background: "#3a6b4f" } })
      .png()
      .toBuffer(),
  });
  await create.getByRole("combobox", { name: /^Botón/ }).selectOption({ label: "Contactar" });
  await create.getByRole("button", { name: "Crear historia" }).click();
  await expect(page.getByText("Historia creada")).toBeVisible();
  await create.getByLabel("Titular").fill("Cambio de horario");
  await create.getByLabel("Texto (opcional)").fill("En noviembre cerramos los lunes.");
  await create.getByRole("button", { name: "Crear historia" }).click();
  await expect(page.getByText("2. Cambio de horario")).toBeVisible();
  await expect(page.locator(".story-list").getByText("Se abre sola")).toHaveCount(1);
  // Un enlace que no es https se rechaza en el servidor.
  await page.getByText("Editar «Cambio de horario»").click();
  const edit = page.locator("details[open]", { hasText: "Editar «Cambio de horario»" });
  await edit.getByRole("combobox", { name: /^Botón/ }).selectOption({ label: "Enlace propio" });
  await edit.getByLabel(/^Texto del botón/).fill("Ver");
  await edit.getByLabel(/^Enlace/).fill("javascript:alert(1)");
  await edit.getByRole("button", { name: "Guardar historia" }).click();
  await expect(edit.getByText("Escribe un enlace que empiece por https://")).toBeVisible();

  // Visitante: la primera vez se abre sola la primera historia.
  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await visitor.goto(home);
  const dialog = visitor.getByRole("dialog", { name: "Nueva terraza" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Historia 1 de 2")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Contactar" })).toHaveAttribute("href", /\/contacto$/);
  expect((await new AxeBuilder({ page: visitor }).withTags(WCAG).analyze()).violations).toEqual([]);
  // Pausada no avanza; al reanudar pasa sola a la siguiente.
  await dialog.getByRole("button", { name: "Pausar" }).click();
  await visitor.waitForTimeout(8000);
  await expect(dialog.getByText("Historia 1 de 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Reanudar" }).click();
  await expect(visitor.getByRole("dialog", { name: "Cambio de horario" })).toBeVisible({ timeout: 10_000 });
  // Teclado: flecha izquierda vuelve; Esc cierra.
  await visitor.keyboard.press("ArrowLeft");
  await expect(visitor.getByRole("dialog", { name: "Nueva terraza" })).toBeVisible();
  await visitor.keyboard.press("Escape");
  await expect(visitor.getByRole("dialog")).toHaveCount(0);

  // Vuelve a entrar: ya vista, no se abre sola; desde los círculos sí.
  await visitor.reload();
  const strip = visitor.getByRole("navigation", { name: "Novedades" });
  await expect(strip.getByRole("button", { name: "Ver la historia: Cambio de horario" })).toBeVisible();
  await visitor.waitForTimeout(500);
  await expect(visitor.getByRole("dialog")).toHaveCount(0);
  await strip.getByRole("button", { name: "Ver la historia: Cambio de horario" }).click();
  const second = visitor.getByRole("dialog", { name: "Cambio de horario" });
  await expect(second.getByText("En noviembre cerramos los lunes.")).toBeVisible();
  await second.getByRole("button", { name: "Cerrar →" }).click();
  await expect(visitor.getByRole("dialog")).toHaveCount(0);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // En escritorio y con las animaciones del sistema desactivadas (habitual en Windows) también avanza
  // sola, con pausa, y el visor se cierra solo tras la última historia.
  const calm = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" })
  ).newPage();
  await calm.goto(home);
  await expect(calm.getByRole("dialog", { name: "Nueva terraza" })).toBeVisible();
  await expect(calm.getByRole("button", { name: "Pausar" })).toBeVisible();
  await expect(calm.getByRole("dialog", { name: "Cambio de horario" })).toBeVisible({ timeout: 10_000 });
  await expect(calm.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

  // Básico: la web no muestra historias.
  await page.goto(org);
  await choosePlan(page, "basic");
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(home);
  await expect(fresh.getByRole("heading", { level: 1, name: "Bienvenidos" })).toBeVisible();
  await expect(fresh.getByRole("navigation", { name: "Novedades" })).toHaveCount(0);
  await expect(fresh.getByRole("dialog")).toHaveCount(0);
});
