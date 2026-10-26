import { expect, test } from "@playwright/test";
import { openTab, register, suffix } from "./helpers";

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

test("estadísticas: cuenta visitas reales a la web, la carta y el QR, y no las de robots ni del propio restaurante", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Visitas");
  const orgSlug = `visitas-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Visitas");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Visitas" })).toBeVisible();
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  await page.goto(`${orgPath}/products`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Croquetas");
  await form.getByLabel("Descripción (opcional)").fill("De jamón ibérico");
  await form.getByLabel("Precio (€)").fill("9,50");
  await form.getByLabel("Gluten", { exact: true }).check();
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.locator("ul.cards").getByText("Croquetas", { exact: true })).toBeVisible();

  await page.goto(orgPath);
  await page.getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  await openTab(page, /^Cartas/);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta de mediodía");
  await page.getByLabel("Identificador de la carta (URL)").fill("mediodia");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.getByPlaceholder("Nueva categoría").fill("Entrantes");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByRole("button", { name: "Añadir a Entrantes" }).click();
  await expect(page.getByRole("button", { name: "Quitar Croquetas" })).toBeVisible();
  await openTab(page, "Publicación y QR");
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();
  const editorUrl = page.url().split("?")[0]!;
  const shortPath = new URL((await page.locator(".qr code").textContent())!).pathname;

  await page.goto(`${estUrl}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Publicar la página").check();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();

  const sitePath = `/${orgSlug}/puerto`;
  const menuPath = `/m/${orgSlug}/puerto/mediodia`;

  // No cuentan: el propio restaurante con sesión y un robot indexador.
  await page.goto(sitePath);
  await expect(page.getByRole("heading", { level: 1, name: "Bienvenidos" })).toBeVisible();
  const crawler = await browser.newContext({ userAgent: GOOGLEBOT_UA });
  await (await crawler.newPage()).goto(sitePath);
  await crawler.close();

  // Cuentan: un cliente que abre la web y la carta, y otro que escanea el QR.
  const visitor = await browser.newContext({ userAgent: MOBILE_UA });
  const v = await visitor.newPage();
  await v.goto(sitePath);
  await expect(v.getByRole("heading", { level: 1, name: "Bienvenidos" })).toBeVisible();
  await v.goto(menuPath);
  await expect(v.getByRole("heading", { level: 1, name: "Carta de mediodía" })).toBeVisible();
  await v.goto(shortPath);
  await expect(v).toHaveURL(new RegExp(`${menuPath}$`));

  await page.goto(estUrl);
  await page
    .getByRole("navigation", { name: "Secciones de la organización" })
    .getByRole("link", { name: "Estadísticas" })
    .click();
  await expect(page.getByRole("heading", { name: "Estadísticas" })).toBeVisible();
  const kpi = (name: string) =>
    page.locator("dl.kpis div", { has: page.getByText(name, { exact: true }) }).locator("dd");
  // La visita se registra justo después de responder: se recarga hasta verla.
  await expect(async () => {
    await page.reload();
    await expect(kpi("Escaneos de QR")).toHaveText("1", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(kpi("Visitas a la web")).toHaveText("1");
  await expect(kpi("Visitas a las cartas")).toHaveText("2");
  await expect(page.getByRole("img", { name: /Páginas vistas por día/ })).toBeVisible();
  const row = page.getByRole("row", { name: /Carta de mediodía/ });
  await expect(row.getByRole("cell")).toHaveText(["2", "1"]);
  await page.getByRole("link", { name: "7 días" }).click();
  await expect(page).toHaveURL(/\?days=7$/);
  await expect(kpi("Visitas a las cartas")).toHaveText("2");

  // Otro restaurante no puede ver estas estadísticas.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Ajeno");
  expect((await other.goto(`${estUrl}/stats`))?.status()).toBe(404);

  // ------------------------------------------------------------------
  // Carta para imprimir
  // ------------------------------------------------------------------
  await page.goto(`${editorUrl}?tab=publicacion`);
  await page.getByRole("link", { name: "Preparar carta para imprimir" }).click();
  const sheet = page.getByRole("article", { name: "Carta para imprimir" });
  await expect(sheet.getByRole("heading", { level: 1, name: "Carta de mediodía" })).toBeVisible();
  await expect(sheet.getByText("Croquetas")).toBeVisible();
  await expect(sheet.getByText("9,50 €")).toBeVisible();
  await expect(sheet.getByText("De jamón ibérico")).toBeVisible();
  await expect(sheet.getByText("Alérgenos: Gluten")).toBeVisible();
  await expect(sheet.getByRole("img", { name: "Código QR de la carta online" })).toBeVisible();
  await expect(page.getByLabel("Publicada (versión 1)")).toBeChecked();

  // Opciones: sin alérgenos ni descripciones y a dos columnas.
  await page.getByLabel("Alérgenos").uncheck();
  await page.getByLabel("Descripciones").uncheck();
  await page.getByLabel("Dos").check();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(sheet.getByText("Alérgenos: Gluten")).toHaveCount(0);
  await expect(sheet.getByText("De jamón ibérico")).toHaveCount(0);
  await expect(page.getByLabel("Alérgenos")).not.toBeChecked();

  // El borrador se puede imprimir, con aviso y sin QR.
  await page.getByLabel("Borrador actual").check();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Estás imprimiendo el borrador")).toBeVisible();
  await expect(sheet.getByRole("img", { name: "Código QR de la carta online" })).toHaveCount(0);

  // Al imprimir solo sale la carta.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("form", { name: "Opciones de impresión" })).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // Sin sesión lleva al login; otra organización no la ve.
  const printUrl = page.url();
  await v.goto(printUrl);
  await expect(v).toHaveURL(/\/login/);
  expect((await other.goto(printUrl))?.status()).toBe(404);

  await ctx.close();
  await visitor.close();
  await otherCtx.close();
});
