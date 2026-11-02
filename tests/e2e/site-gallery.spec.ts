import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { choosePlan, register, setSitePublished, suffix } from "./helpers";

async function upload(page: Page, color: string, caption: string) {
  await page.locator('input[name="image"]').setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
      .png()
      .toBuffer(),
  });
  await page.getByLabel("Pie de foto (opcional)").fill(caption);
  await page.getByRole("button", { name: "Añadir a la galería" }).click();
  await expect(page.getByText("Foto añadida a la galería")).toBeVisible();
}

test("galería: se sube en el panel, se ordena y sale en la portada de la web", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await register(page, "Galeria");
  const orgSlug = `galeria-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Galería");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await choosePlan(page, "pro");
  await expect(page.getByRole("heading", { level: 1, name: "Casa Galería" })).toBeVisible();
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);

  await page.goto(`${est}/site?tab=galeria`);
  await expect(page.getByText("Todavía no hay fotos en la galería.")).toBeVisible();
  await upload(page, "#336699", "Terraza");
  await upload(page, "#994433", "Cocina");
  await expect(page.getByLabel("Pie de la foto 1 (opcional)")).toHaveValue("Terraza");
  // Cocina pasa delante y se cambia su pie.
  await page.getByRole("button", { name: "← Mover foto 2 antes" }).click();
  await expect(page.getByLabel("Pie de la foto 1 (opcional)")).toHaveValue("Cocina");
  await page.getByLabel("Pie de la foto 1 (opcional)").fill("Nuestra cocina");
  await page.getByRole("button", { name: "Guardar pie" }).first().click();
  await expect(page.getByText("Pie de foto guardado")).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/${orgSlug}/puerto`);
  const gallery = visitor.locator("section#galeria");
  await expect(gallery.getByRole("heading", { name: "Galería" })).toBeVisible();
  await expect(gallery.locator("figcaption")).toHaveText(["Nuestra cocina", "Terraza"]);
  const src = (await gallery.getByRole("img", { name: "Terraza" }).getAttribute("src"))!;
  expect((await visitor.request.get(src)).status()).toBe(200);

  // Quitar una foto la retira de la web y su imagen deja de servirse.
  await page.getByRole("button", { name: "Quitar foto 2" }).click();
  await expect(page.getByRole("button", { name: "Quitar foto 2" })).toHaveCount(0);
  await expect(page.locator(".gallery-grid li")).toHaveCount(1);
  await visitor.reload();
  await expect(gallery.locator("figcaption")).toHaveText(["Nuestra cocina"]);
  expect((await visitor.request.get(src)).status()).toBe(404);
});
