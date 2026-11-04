import { expect, test } from "@playwright/test";
import { createOrganization, openTab, register, setDailyHours, suffix } from "./helpers";

function localDate(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(Date.now() + daysAhead * 86_400_000));
}

test("reserva online: el local la activa, un cliente reserva y el personal la ve", async ({ page, browser }) => {
  await register(page, "Online");
  await createOrganization(page, "Casa Online");
  await page.getByLabel("Nombre").fill("Local Online");
  await page.getByLabel("Identificador (URL)").fill(`online-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Online" }).click();
  await page.waitForURL(/\/establishments\/[0-9a-f-]+$/);
  const estUrl = page.url();

  await openTab(page, "Horario");
  await setDailyHours(page, [
    ["13:00", "16:00"],
    ["20:00", "00:00"],
  ]);

  await page.goto(`${estUrl}/floor`);
  await page.getByLabel("Nombre de la zona").fill("Comedor");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await page.getByText("Nueva mesa en Comedor").click();
  const tableForm = page.locator("details", { hasText: "Nueva mesa en Comedor" });
  await tableForm.getByLabel("Nombre de la mesa").fill("T1");
  await tableForm.getByLabel("Máximo").fill("4");
  await tableForm.getByRole("button", { name: "Crear mesa" }).click();
  await expect(page.getByRole("button", { name: /^Mesa T1 / })).toBeVisible();

  // Activar reservas online.
  await page.goto(`${estUrl}/reservations`);
  await expect(page.getByText("Desactivadas.")).toBeVisible();
  await page.getByText("Configurar reservas online").click();
  await page.getByLabel(/Aceptar reservas desde/).check();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Activadas.")).toBeVisible();
  const publicHref = (await page.getByRole("link", { name: /\/r\/[a-z0-9-]+\/online-/ }).getAttribute("href"))!;
  expect(publicHref).toMatch(/^\/r\/[a-z0-9-]+\/online-[0-9a-f]+$/);

  // Cliente anónimo.
  const date = localDate(3);
  const anon = await browser.newContext();
  const client = await anon.newPage();
  await client.goto(publicHref);
  await expect(client.getByRole("heading", { name: "Reservar en Local Online" })).toBeVisible();
  await client.getByLabel("Fecha").fill(date);
  await client.getByLabel("Comensales").selectOption("2");
  await client.getByRole("button", { name: "Ver horas disponibles" }).click();
  await client.getByLabel("21:00").check();
  await client.getByLabel("Nombre", { exact: true }).fill("Carmen Web");
  await client.getByLabel("Correo").fill(`carmen-${suffix()}@example.test`);
  await client.getByLabel(/Acepto que Casa Online trate estos datos/).check();
  await client.getByRole("button", { name: "Reservar" }).click();
  await expect(client.getByText(/¡Reserva confirmada! 2 personas, .* Código de reserva: [0-9A-F]{10}\./)).toBeVisible();
  // Tras confirmar, el formulario desaparece para no inducir a reservar dos veces.
  await expect(client.getByRole("button", { name: "Reservar" })).toHaveCount(0);
  await expect(client.getByRole("link", { name: "Hacer otra reserva" })).toBeVisible();
  const cancelHref = (await client.getByRole("link", { name: "Cancelar esta reserva" }).getAttribute("href"))!;
  expect(cancelHref).toMatch(/^\/r\/[a-z0-9-]+\/online-[0-9a-f]+\/cancelar\/[A-Za-z0-9_-]{43}$/);

  // Esa hora deja de ofrecerse (solo había una mesa).
  await client.goto(`${publicHref}?date=${date}&party=2`);
  await expect(client.getByLabel("21:00")).toHaveCount(0);
  await expect(client.getByLabel("22:30")).toBeVisible();

  // El personal la ve en la vista del día, marcada como Web y con mesa asignada.
  await page.goto(`${estUrl}/reservations?date=${date}`);
  const list = page.locator("section", { has: page.getByRole("heading", { name: "Reservas del día" }) });
  await expect(list.getByText(/21:00–22:30 · Carmen Web · 2 pers\. · Mesa T1/)).toBeVisible();
  await expect(list.locator(".badge", { hasText: "Web" })).toBeVisible();

  // El cliente cancela con su enlace: la reserva queda cancelada y la hora vuelve a ofrecerse.
  await client.goto(cancelHref);
  await expect(client.getByRole("heading", { name: "Cancelar reserva" })).toBeVisible();
  await expect(client.getByText(/^Reserva [0-9A-F]{10}: 2 personas, /)).toBeVisible();
  await client.getByRole("button", { name: "Cancelar la reserva" }).click();
  await expect(client.getByText("Reserva cancelada. Gracias por avisar.")).toBeVisible();
  await expect(client.getByRole("button", { name: "Cancelar la reserva" })).toHaveCount(0);
  await client.goto(cancelHref);
  await expect(client.getByText("Esta reserva ya estaba cancelada.")).toBeVisible();
  await client.goto(`${publicHref}?date=${date}&party=2`);
  await expect(client.getByLabel("21:00")).toBeVisible();
  await page.goto(`${estUrl}/reservations?date=${date}`);
  await expect(list.getByText(/Carmen Web/).locator("..").getByText("Cancelada")).toBeVisible();
  // Un enlace inventado no lleva a ninguna parte.
  expect((await client.goto(cancelHref.replace(/[^/]+$/, "A".repeat(43))))?.status()).toBe(404);

    // Sin horas libres (6 personas y la única mesa es de 4): el cliente se apunta a la lista de espera.
  await client.goto(`${publicHref}?date=${date}&party=6`);
  await expect(client.getByText("No quedan horas disponibles online para ese día.")).toBeVisible();
  await expect(client.getByRole("heading", { name: "Apúntate a la lista de espera" })).toBeVisible();
  await expect(client.getByLabel("Desde")).toHaveValue("13:00");
  await client.getByLabel("Desde").fill("20:30");
  await client.getByLabel("Hasta").fill("22:00");
  await client.getByLabel("Nombre", { exact: true }).fill("Luis Espera");
  await client.getByLabel("Teléfono").fill("600 111 222");
  await client.getByLabel(/Acepto que Casa Online trate estos datos únicamente para gestionar mi solicitud/).check();
  await client.getByRole("button", { name: "Apuntarme a la lista de espera" }).click();
  await expect(client.getByText(/^Te hemos apuntado a la lista de espera: 6 personas, .*, de 20:30 a 22:00\./)).toBeVisible();
  await page.goto(`${estUrl}/reservations?date=${date}`);
  const waitlist = page.locator("section", { has: page.getByRole("heading", { name: /Lista de espera/ }) });
  const entry = waitlist.locator("li", { hasText: "Luis Espera" });
  await expect(entry.getByText(/6 personas · entre 20:30 y 22:00/)).toBeVisible();
  await expect(entry.locator(".badge", { hasText: "Web" })).toBeVisible();

  // Un local inexistente o sin reservas online responde 404.
  expect((await client.goto(`${publicHref}-otro`))?.status()).toBe(404);
  await anon.close();
});
