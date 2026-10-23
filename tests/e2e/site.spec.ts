import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { register, suffix } from "./helpers";

async function jpeg(color: string): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 600, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}

test("página pública del local con foto, carta destacada y despublicación", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Sitio");
  const orgSlug = `sitio-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Sitio");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Sitio" })).toBeVisible();
  const orgPath = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Altamar");
  await page.getByLabel("Identificador (URL)").fill("altamar");
  await page.getByLabel("Dirección (opcional)").fill("Paseo Marítimo 34, Barcelona");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();

  // Producto con foto
  await page.getByRole("link", { name: "Productos" }).click();
  const form = page.locator("section", {
    has: page.getByRole("heading", { name: "Nuevo producto" }),
  });
  await form.getByLabel("Nombre").fill("Pulpo a la brasa");
  await form.getByLabel("Precio (€)").fill("16,50");
  await form.getByRole("button", { name: "Crear producto" }).click();
  await page.getByRole("link", { name: "Pulpo a la brasa", exact: true }).click();
  await page.locator('input[name="image"]').setInputFiles({
    name: "pulpo.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg("#884422"),
  });
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByRole("img", { name: "Foto de Pulpo a la brasa" })).toBeVisible();

  // Carta publicada con el plato recomendado
  await page.goto(orgPath);
  await page.getByRole("link", { name: "Altamar" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.getByPlaceholder("Nueva categoría").fill("Del mar");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByLabel("Producto para Del mar").selectOption({ label: "Pulpo a la brasa (16,50 €)" });
  await page.getByRole("button", { name: "Añadir a Del mar" }).click();
  await page.getByRole("button", { name: "Recomendar Pulpo a la brasa" }).click();
  await expect(
    page.getByRole("button", {
      name: "Quitar recomendado de Pulpo a la brasa",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();

  // Perfil público
  await page.goto(estUrl);
  await page.getByRole("link", { name: "Página pública" }).click();
  await page.locator('input[name="image"]').setInputFiles({
    name: "sala.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg("#223344"),
  });
  await page.getByRole("button", { name: "Subir foto principal" }).click();
  await expect(page.getByRole("img", { name: "Foto principal" })).toBeVisible();
  await page.getByLabel("Eslogan (junto al nombre)").fill("Cocina mediterránea");
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Sabores del mar");
  await page.getByLabel("Carta destacada").selectOption({ label: "Carta" });
  await page.getByLabel("Instagram").fill("@altamar.bcn");
  const h1 = page.getByRole("group", { name: "Destacado 1 (opcional)" });
  await h1.getByLabel("Título").fill("Pescado del día");
  await page.getByLabel("Publicar la página").check();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();

  // Estilos en tarjetas: el actual marcado, cambiar sin tocar el contenido y vista previa de otro.
  const card = (name: string) => page.getByRole("article", { name: `Estilo ${name}` });
  await expect(card("Mediterráneo").getByText("Actual")).toBeVisible();
  await card("Futurista").getByRole("button", { name: "Usar Futurista" }).click();
  await expect(card("Futurista").getByText("Actual")).toBeVisible();
  await expect(card("Mediterráneo").getByRole("button", { name: "Usar Mediterráneo" })).toBeVisible();
  await expect(page.getByLabel("Titular (obligatorio para publicar)")).toHaveValue("Sabores del mar");
  const previewHref = (await card("Clásico").getByRole("link", { name: /Vista previa/ }).getAttribute("href"))!;
  expect(previewHref).toMatch(/\/preview\/site\/.+\?theme=clasico$/);
  const previewPage = await page.context().newPage();
  await previewPage.goto(previewHref);
  await expect(previewPage.getByText(/Vista previa · estilo Clásico/)).toBeVisible();
  await expect(previewPage.getByRole("heading", { level: 1, name: "Sabores del mar" })).toBeVisible();
  await previewPage.close();

  // Visitante anónimo
  const visitor = await (await browser.newContext()).newPage();
  // La vista previa exige sesión.
  await visitor.goto(previewHref);
  await expect(visitor).toHaveURL(/\/login/);
  const siteUrl = `/${orgSlug}/altamar`;
  await visitor.goto(siteUrl);
  await expect(visitor.getByRole("heading", { level: 1, name: "Sabores del mar" })).toBeVisible();
  await expect(visitor.getByText("Cocina mediterránea")).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Pescado del día" })).toBeVisible();
  await expect(visitor.getByRole("tab", { name: "Recomendados" })).toBeVisible();
  const dish = visitor.getByRole("img", { name: "Pulpo a la brasa" });
  await expect(dish).toBeVisible();
  const dishSrc = (await dish.getAttribute("src"))!;
  expect((await visitor.request.get(dishSrc)).headers()["content-type"]).toBe("image/webp");
  await expect(visitor.getByRole("link", { name: "@altamar.bcn" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/altamar.bcn/",
  );
  await visitor.getByRole("link", { name: /Ver carta completa/ }).click();
  await expect(visitor).toHaveURL(new RegExp(`/m/${orgSlug}/altamar/carta$`));
  // La carta completa se integra en la web del local: misma navegación y fotos.
  await expect(visitor.getByRole("heading", { level: 1, name: "Carta" })).toBeVisible();
  await expect(visitor.getByRole("img", { name: "Pulpo a la brasa" })).toBeVisible();
  await expect(visitor.getByText("Recomendado")).toBeVisible();
  // En escritorio la barra inferior está oculta: el logotipo lleva al inicio.
  await visitor.getByRole("banner").getByRole("link", { name: /Altamar/ }).click();
  await expect(visitor).toHaveURL(new RegExp(`/${orgSlug}/altamar$`));

  // Despublicar: la página y la foto principal dejan de estar disponibles
  await page.getByLabel("Publicar la página").uncheck();
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  expect((await visitor.request.get(siteUrl)).status()).toBe(404);
  const heroSrc = (await page.getByRole("img", { name: "Foto principal" }).getAttribute("src"))!;
  const heroId = heroSrc.split("/").at(-1)!;
  expect((await visitor.request.get(`/media/${heroId}`)).status()).toBe(404);
  // La ruta privada exige sesión de la organización.
  expect((await visitor.request.get(heroSrc)).status()).toBe(404);
});
