import { expect, test, type Page } from "@playwright/test";
import { openTab, register, setSitePublished, suffix } from "./helpers";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Día de la semana de hoy en Madrid (zona del local por defecto), 0 = lunes. */
function todayIndex(): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Madrid" }).format(new Date());
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
}

async function createPublishedMenu(page: Page, estUrl: string, name: string, slug: string, dish: string) {
  await page.goto(`${estUrl}/menus`);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill(name);
  await page.getByLabel("Identificador de la carta (URL)").fill(slug);
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.waitForURL(/\/menus\/[0-9a-f-]+/);
  const editor = page.url().split("?")[0]!;
  await page.getByPlaceholder("Nueva categoría").fill("Platos");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByLabel("Producto para Platos").selectOption({ label: `${dish} (9,00 €)` });
  await page.getByRole("button", { name: "Añadir a Platos" }).click();
  await expect(page.getByRole("button", { name: `Quitar ${dish}` })).toBeVisible();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();
  return editor;
}

/** Deja la carta con una franja en los días indicados (índices 0 = lunes). */
async function setSchedule(page: Page, editor: string, days: number[], opens: string, closes: string) {
  await page.goto(`${editor}?tab=ajustes`);
  await page.getByLabel("Solo en estas franjas").check();
  // Una sola franja: quita las demás.
  while ((await page.getByRole("button", { name: /^Quitar franja/ }).count()) > 0) {
    await page.getByRole("button", { name: /^Quitar franja/ }).last().click();
  }
  for (const [i, day] of DAYS.entries()) {
    const box = page.getByLabel(`${day}, franja 1`);
    if (days.includes(i)) await box.check();
    else await box.uncheck();
  }
  await page.getByLabel("Franja 1, inicio").fill(opens);
  await page.getByLabel("Franja 1, fin").fill(closes);
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
}

test("cartas con horario: la web muestra la del momento y cada carta dice cuándo se sirve", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Horarios");
  const orgSlug = `horas-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Horarios");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Horarios" })).toBeVisible();
  const org = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  for (const name of ["Pulpo", "Tostada"]) {
    await page.goto(`${org}/products`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Precio (€)").fill("9");
    await form.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.locator("ul.cards").getByText(name, { exact: true })).toBeVisible();
  }
  await createPublishedMenu(page, est, "Carta", "carta", "Pulpo");
  const breakfast = await createPublishedMenu(page, est, "Desayunos", "desayunos", "Tostada");

  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Carta destacada").selectOption({ label: "Carta" });
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);

  // Desayunos se sirve todos los días a todas horas (dos franjas que cubren el día):
  // la web la muestra en lugar de la destacada.
  await page.goto(`${breakfast}?tab=ajustes`);
  await page.getByLabel("Solo en estas franjas").check();
  for (const day of DAYS) await page.getByLabel(`${day}, franja 1`).check();
  await page.getByLabel("Franja 1, inicio").fill("00:00");
  await page.getByLabel("Franja 1, fin").fill("12:00");
  await page.getByRole("button", { name: "+ Añadir franja" }).click();
  for (const day of DAYS) await page.getByLabel(`${day}, franja 2`).check();
  await page.getByLabel("Franja 2, inicio").fill("12:00");
  await page.getByLabel("Franja 2, fin").fill("00:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/${orgSlug}/puerto`);
  await expect(visitor.getByRole("heading", { name: "Tostada" })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Pulpo" })).toHaveCount(0);
  // El enlace único lleva a la carta del momento.
  await visitor.goto(`/m/${orgSlug}/puerto`);
  await expect(visitor).toHaveURL(new RegExp(`/m/${orgSlug}/puerto/desayunos$`));
  const nav = visitor.getByRole("navigation", { name: "Nuestras cartas" });
  await expect(nav.getByRole("link", { name: "Desayunos" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Carta" })).toBeVisible();

  // Solo otro día de la semana: ahora no se sirve; la web vuelve a la destacada.
  const other = (todayIndex() + 3) % 7;
  await setSchedule(page, breakfast, [other], "08:00", "12:00");
  await visitor.goto(`/${orgSlug}/puerto`);
  await expect(visitor.getByRole("heading", { name: "Pulpo" })).toBeVisible();
  await visitor.goto(`/m/${orgSlug}/puerto/desayunos`);
  await expect(visitor.getByText("Ahora no se sirve esta carta.")).toBeVisible();
  const shortDay = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][other]!;
  await expect(visitor.getByText(`${shortDay} 08:00 – 12:00`)).toBeVisible();
  await visitor.goto(`/m/${orgSlug}/puerto`);
  await expect(visitor).toHaveURL(new RegExp(`/m/${orgSlug}/puerto/carta$`));

  // Franjas solapadas: error claro y no se guardan.
  await page.goto(`${breakfast}?tab=ajustes`);
  await page.getByRole("button", { name: "+ Añadir franja" }).click();
  await page.getByLabel(`${DAYS[other]}, franja 2`).check();
  await page.getByLabel("Franja 2, inicio").fill("11:00");
  await page.getByLabel("Franja 2, fin").fill("13:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Hay franjas que se solapan algún día").first()).toBeVisible();

  // La lista de cartas del panel muestra el horario y el enlace a la carta del momento.
  await page.goto(`${est}/menus`);
  await expect(page.getByText(`Se sirve: ${shortDay} 08:00 – 12:00`)).toBeVisible();
  await expect(page.getByText("Se sirve: siempre")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`/m/${orgSlug}/puerto$`) })).toBeVisible();

  // Volver a «siempre».
  await page.goto(`${breakfast}?tab=ajustes`);
  await page.getByLabel("Siempre").check();
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
  await visitor.goto(`/m/${orgSlug}/puerto/desayunos`);
  await expect(visitor.getByText("Ahora no se sirve esta carta.")).toHaveCount(0);
});
