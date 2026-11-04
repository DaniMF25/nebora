import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, setDailyHours, setSitePublished, suffix } from "./helpers";

function localDate(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );
}

test("reserva online en inglés: página, errores y confirmación en el idioma elegido", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await register(page, "Booking");
  await createOrganization(page, "Casa Booking");
  const estSlug = `booking-${suffix()}`;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill(estSlug);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/\/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();

  await openTab(page, "Datos del local");
  await page.getByLabel("Inglés").check();
  await page.getByRole("button", { name: "Guardar idiomas" }).click();
  await expect(page.getByText("Idiomas guardados")).toBeVisible();
  await page.goto(estUrl);
  await openTab(page, "Horario");
  await setDailyHours(page, [["20:00", "23:30"]]);
  await page.goto(`${estUrl}/floor`);
  await page.getByLabel("Nombre de la zona").fill("Comedor");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await page.getByText("Nueva mesa en Comedor").click();
  const tableForm = page.locator("details", { hasText: "Nueva mesa en Comedor" });
  await tableForm.getByLabel("Nombre de la mesa").fill("T1");
  await tableForm.getByLabel("Máximo").fill("4");
  await tableForm.getByRole("button", { name: "Crear mesa" }).click();
  await expect(page.getByRole("button", { name: /^Mesa T1 / })).toBeVisible();
  await page.goto(`${estUrl}/reservations`);
  await page.getByText("Configurar reservas online").click();
  await page.getByLabel(/Aceptar reservas desde/).check();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Activadas.")).toBeVisible();
  const publicHref = (await page.getByRole("link", { name: /\/r\/[a-z0-9-]+\/booking-/ }).getAttribute("href"))!;

  // Sin web publicada: página propia con selector de idioma.
  const client = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await client.goto(`${publicHref}?lang=en`);
  await expect(client.getByRole("heading", { name: "Book a table at Puerto" })).toBeVisible();
  await expect(client.getByRole("link", { name: "Español" })).toBeVisible();
  await client.getByLabel("Date").fill(localDate(3));
  await client.getByLabel("Guests").selectOption("2");
  await client.getByRole("button", { name: "See available times" }).click();
  // Al buscar se conserva el idioma.
  await expect(client).toHaveURL(/lang=en/);
  await expect(client.getByRole("heading", { name: /2 people$/ })).toBeVisible();
  await client.getByLabel("21:00").check();
  await client.getByLabel("Name", { exact: true }).fill("Jane Web");
  // Sin contacto ni consentimiento: errores en inglés.
  await client.getByRole("button", { name: "Book", exact: true }).click();
  await expect(client.locator("form [role=alert]")).toContainText("Please check the details");
  await expect(client.locator("form [role=alert]")).toContainText(
    "You must accept the data processing to manage the booking",
  );
  // Un error no vacía lo escrito.
  await expect(client.getByLabel("Name", { exact: true })).toHaveValue("Jane Web");
  await expect(client.getByLabel("21:00")).toBeChecked();
  await client.getByLabel(/I agree that Casa Booking may process this data/).check();
  await client.getByRole("button", { name: "Book", exact: true }).click();
  await expect(client.locator("form [role=alert]")).toContainText(
    "Please give a phone number or an email so we can contact you",
  );
  await client.getByLabel("Email").fill(`jane-${suffix()}@example.test`);
  await client.getByRole("button", { name: "Book", exact: true }).click();
  await expect(client.getByText(/Booking confirmed! 2 people, .* Booking code: [0-9A-F]{10}\./)).toBeVisible();
  await expect(client.getByRole("link", { name: "Make another booking" })).toHaveAttribute("href", /lang=en$/);

  // El navegador en inglés basta para que la página salga en inglés.
  await client.goto(publicHref);
  await expect(client.getByRole("heading", { name: "Book a table at Puerto" })).toBeVisible();
  // Y en español si se pide.
  await client.goto(`${publicHref}?lang=es`);
  await expect(client.getByRole("heading", { name: "Reservar en Puerto" })).toBeVisible();

  // Con la web publicada, el botón «Book a table» de la web en inglés lleva a la reserva en inglés.
  await page.goto(`${estUrl}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  const site = publicHref.replace(/^\/r\//, "/");
  await client.goto(`${site}?lang=en`);
  // En escritorio, el selector de idioma y el botón de reservar de la cabecera van alineados y miden lo mismo.
  const header = client.locator("header").first();
  const langBox = (await header.locator('summary[aria-label^="Language"]').boundingBox())!;
  const ctaBox = (await header.getByRole("link", { name: "Book", exact: true }).boundingBox())!;
  expect(Math.abs(langBox.y - ctaBox.y), "misma altura en pantalla").toBeLessThanOrEqual(1);
  expect(Math.abs(langBox.height - ctaBox.height), "mismo alto").toBeLessThanOrEqual(1);
  await client.getByRole("link", { name: "Book a table" }).first().click();
  await expect(client).toHaveURL(/\/r\/.*\?lang=en$/);
  await expect(client.getByRole("heading", { level: 1, name: "Book a table" })).toBeVisible();
  await expect(client.getByText("Online booking", { exact: true })).toBeVisible();
});
