import { expect, test } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

test("QR: enlace permanente que sobrevive al cambio de identificador y descarga protegida", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Qr");
  await createOrganization(page, "Casa QR");
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Local QR");
  await page.getByLabel("Identificador (URL)").fill(`qr-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  await page.goto(`${orgPath}/products`);
  const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
  await form.getByLabel("Nombre").fill("Gazpacho");
  await form.getByLabel("Precio (€)").fill("5");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.locator("ul.cards").getByText("Gazpacho", { exact: true })).toBeVisible();

  await page.goto(orgPath);
  await page.getByRole("link", { name: "Local QR" }).click();
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta QR");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.getByPlaceholder("Nueva categoría").fill("Sopas");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await expect(page.getByRole("heading", { name: "Sopas", level: 4 })).toBeVisible();
  await page.getByRole("button", { name: "Añadir a Sopas" }).click();
  await expect(page.getByRole("button", { name: "Quitar Gazpacho" })).toBeVisible();

  const shortUrl = (await page.locator(".qr code").textContent())!;
  expect(shortUrl).toMatch(/^http:\/\/localhost:\d+\/q\/[0-9a-f]{12}$/);
  const editorUrl = page.url();
  const qrUrl = `${editorUrl}/qr?format=svg`;

  // Sin publicar: el enlace corto no muestra nada.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  expect((await visitor.goto(shortUrl))?.status()).toBe(404);

  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText("Publicada la versión 1")).toBeVisible();
  await visitor.goto(shortUrl);
  await expect(visitor).toHaveURL(/\/m\/.+\/carta$/);
  await expect(visitor.getByText("Gazpacho")).toBeVisible();

  // Cambiar el identificador no rompe el QR.
  await page.getByLabel("Identificador (URL)").fill("carta-nueva");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Guardado")).toBeVisible();
  await visitor.goto(shortUrl);
  await expect(visitor).toHaveURL(/\/m\/.+\/carta-nueva$/);
  await expect(visitor.getByText("Gazpacho")).toBeVisible();

  // Descarga del QR: miembros sí; anónimos y otros restaurantes no.
  const svg = await page.request.get(qrUrl);
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toContain("<svg");
  const png = await page.request.get(`${editorUrl}/qr?format=png&download=1`);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect(png.headers()["content-disposition"]).toContain('filename="qr-carta-nueva.png"');
  await expect(page.getByRole("img", { name: "Código QR de Carta QR" })).toBeVisible();

  expect((await visitor.request.get(qrUrl)).status()).toBe(401);
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Otro");
  expect((await other.request.get(qrUrl)).status()).toBe(404);

  await ctx.close();
  await anon.close();
  await otherCtx.close();
});
