import { expect, test } from "@playwright/test";
import { choosePlan, createOrganization, register, setSitePublished, suffix } from "./helpers";

// Página de contacto, CTA de la portada y bandeja de mensajes (D-049).
test("contacto: CTA en la portada, formulario en la web, mensaje en el panel; en Básico sin formulario", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await register(page, "Contacto");
  const org = await createOrganization(page, "Casa Contacto", "advanced");
  const slug = `puerto-${suffix()}`;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill(slug);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();
  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByLabel("Teléfono", { exact: true }).fill("+34 600 111 222");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  const orgSlug = await page.getByRole("link", { name: "Ver página pública" }).getAttribute("href");
  const home = orgSlug!;

  // Visitante: bloque de contacto en la portada y página de contacto.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(home);
  await expect(visitor.getByRole("heading", { name: "¿Hablamos?" })).toBeVisible();
  await visitor.getByRole("link", { name: "Contactar" }).click();
  await expect(visitor).toHaveURL(new RegExp(`${home}/contacto$`));
  await expect(visitor.getByRole("heading", { level: 1, name: "Contacto" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "+34 600 111 222" }).first()).toBeVisible();

  // Sin teléfono ni correo: error del servidor y no se pierde lo escrito.
  await visitor.getByLabel("Nombre", { exact: true }).fill("Laura");
  await visitor.getByLabel("Mensaje", { exact: true }).fill("¿Hacéis menús para grupos de 20?");
  await visitor.getByRole("checkbox").check();
  await visitor.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(visitor.locator("form [role=alert]")).toContainText("Indica un teléfono o un correo");
  await expect(visitor.getByLabel("Mensaje", { exact: true })).toHaveValue("¿Hacéis menús para grupos de 20?");
  await visitor.getByLabel("Correo electrónico").fill("laura@example.test");
  // Motivo del mensaje (D-052).
  await visitor.getByText("Reserva de grupo", { exact: true }).click();
  await visitor.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(visitor.getByText("Mensaje enviado. Te responderemos lo antes posible.")).toBeVisible();

  // Panel: aviso en Inicio y bandeja.
  await page.goto(org);
  await page.getByRole("link", { name: "1 mensaje sin leer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Mensajes" })).toBeVisible();
  await expect(page.getByText("¿Hacéis menús para grupos de 20?")).toBeVisible();
  await expect(page.getByRole("link", { name: "laura@example.test" })).toBeVisible();
  await expect(page.getByText("Reserva de grupo")).toBeVisible();
  await page.getByRole("button", { name: "Marcar como leído (Laura)" }).click();
  await expect(page.getByRole("button", { name: "Marcar como no leído (Laura)" })).toBeVisible();
  await page.getByRole("button", { name: "Archivar el mensaje de Laura" }).click();
  await expect(page.getByText("No hay mensajes.")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Apartados de la página" })
    .getByRole("link", { name: "Archivados" })
    .click();
  await expect(page.getByText("¿Hacéis menús para grupos de 20?")).toBeVisible();

  // Básico: la página de contacto muestra los datos, sin formulario; la bandeja no existe.
  await page.goto(org);
  await choosePlan(page, "basic");
  await visitor.goto(`${home}/contacto`);
  await expect(visitor.getByRole("link", { name: "+34 600 111 222" }).first()).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Enviar mensaje" })).toHaveCount(0);
  expect((await page.goto(`${est}/messages`))!.status()).toBe(404);
});
