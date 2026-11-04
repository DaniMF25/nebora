import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "contraseña-e2e-suficientemente-larga";

export function suffix(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Cada persona que se registra en las pruebas lo hace desde su propio
 * navegador y, como en la realidad, con su propia IP: sin esto, todas las
 * pruebas compartirían IP y agotarían el límite de registros por IP (que no se
 * relaja para las pruebas). La aplicación toma la IP de X-Forwarded-For cuando
 * no hay cabecera de plataforma configurada (CLIENT_IP_HEADER).
 */
async function setOwnClientIp(page: Page): Promise<void> {
  const b = randomBytes(3);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.${b[0]}.${b[1]}.${b[2]}` });
}

export async function register(page: Page, name: string): Promise<string> {
  await setOwnClientIp(page);
  const local = name.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
  const email = `${local}-${suffix()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

export async function createOrganization(page: Page, name: string, plan: PlanId = "pro"): Promise<string> {
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Identificador (URL)").fill(`${name.toLowerCase().replace(/\s+/g, "-")}-${suffix()}`);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  if (plan !== "basic") await choosePlan(page, plan);
  return page.url();
}

export type PlanId = "basic" | "advanced" | "pro";

/**
 * Cambia el plan de la organización recién abierta desde la página «Plan»
 * (D-046) y vuelve a su inicio. Las organizaciones nuevas empiezan en Básico;
 * las pruebas que usan reservas, sala, inventario… eligen el plan que necesitan.
 */
export async function choosePlan(page: Page, plan: PlanId): Promise<void> {
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  const home = page.url();
  await page.goto(`${home}/plan`);
  await page.locator(`input[name="plan"][value="${plan}"]`).check();
  await page.getByRole("button", { name: "Cambiar de plan" }).click();
  await expect(page.getByText("Plan cambiado")).toBeVisible();
  await page.goto(home);
}

/** Abre una pestaña de la página actual del panel (enlaces `?tab=`). */
export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "Apartados de la página" }).getByRole("link", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Apartados de la página" }).getByRole("link", { name }),
  ).toHaveAttribute("aria-current", "page");
}

/**
 * Horario semanal igual todos los días: abre el lunes, rellena sus turnos y
 * los copia al resto con el editor (pestaña «Horario» ya abierta). Guarda.
 */
export async function setDailyHours(page: Page, slots: [string, string][]): Promise<void> {
  await page.getByLabel("Lunes abierto").check();
  for (const [n, [opens, closes]] of slots.entries()) {
    if (n > 0) await page.getByRole("button", { name: "Añadir turno en Lunes" }).click();
    await page.getByLabel(`Lunes, turno ${n + 1}, apertura`).fill(opens);
    await page.getByLabel(`Lunes, turno ${n + 1}, cierre`).fill(closes);
  }
  await page.getByLabel("Copiar el horario del").selectOption({ label: "lunes" });
  await page.getByLabel("Copiar a").selectOption({ label: "todos los días" });
  await page.getByRole("button", { name: "Copiar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();
}

/** Publica (o retira) la web del local con el interruptor de la cabecera de «Web». */
export async function setSitePublished(page: Page, published: boolean): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Publicar la web" });
  if ((await toggle.getAttribute("aria-checked")) !== String(published)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(published));
}

/** Acceso rápido del resumen del local («Cartas», «Sala», «Turnos»…), por su título visible. */
export function quickLink(page: Page, title: string) {
  return page
    .getByRole("region", { name: "Accesos rápidos" })
    .getByRole("link", { name: new RegExp(`^${title} `) });
}

/**
 * Enlace del menú lateral. Gestión y Organización son plegables (acordeón):
 * si el enlace está en un grupo cerrado, se abre el grupo primero, como haría
 * una persona.
 */
export async function navLink(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  const link = nav.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) {
    await nav
      .locator("details.side-section")
      .filter({ has: page.getByRole("link", { name, exact: true, includeHidden: true }) })
      .locator("summary")
      .click();
  }
  await expect(link).toBeVisible();
  return link;
}
