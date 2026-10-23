import { expect, test, type Locator, type Page } from "@playwright/test";
import { createOrganization, register, suffix } from "./helpers";

/** Posición en celdas a partir del estilo (left/top en %) de la mesa. */
async function cellOf(table: Locator, planWidth: number, planHeight: number) {
  const style = (await table.getAttribute("style"))!;
  const left = Number(/left:\s*([\d.]+)%/.exec(style)![1]);
  const top = Number(/top:\s*([\d.]+)%/.exec(style)![1]);
  return { x: Math.round((left / 100) * planWidth), y: Math.round((top / 100) * planHeight) };
}

/** Promesa que se resuelve cuando responde la Server Action (petición POST a la página). */
function serverActionDone(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined);
}

/** Arrastra la mesa con el ratón hasta la celda (x, y) del plano. */
async function dragTo(page: Page, plan: Locator, table: Locator, x: number, y: number, w: number, h: number) {
  await plan.scrollIntoViewIfNeeded();
  const tb = (await table.boundingBox())!;
  const pb = (await plan.boundingBox())!;
  const cellW = pb.width / w;
  const cellH = pb.height / h;
  await page.mouse.move(tb.x + cellW / 2, tb.y + cellH / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + (x + 0.5) * cellW, pb.y + (y + 0.5) * cellH, { steps: 8 });
  await page.mouse.up();
}

test("plano de sala: zonas, mesas, arrastrar, teclado y solapes rechazados", async ({ page, browser }) => {
  await register(page, "Sala");
  await createOrganization(page, "Casa Sala");
  await page.getByLabel("Nombre").fill("Local Sala");
  await page.getByLabel("Identificador (URL)").fill(`sala-${suffix()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("link", { name: "Local Sala" }).click();
  await page.getByRole("link", { name: "Plano de sala (zonas y mesas)" }).click();
  await expect(page.getByText("Todavía no hay zonas")).toBeVisible();

  await page.getByLabel("Nombre de la zona").fill("Comedor");
  await page.getByLabel("Ancho del plano").fill("10");
  await page.getByLabel("Fondo del plano").fill("6");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("heading", { name: /Comedor/ })).toBeVisible();

  for (const [name, max] of [["M1", "4"], ["M2", "2"]] as const) {
    const form = page.locator("details", { hasText: "Nueva mesa en Comedor" });
    // El desplegable sigue abierto tras crear la primera mesa.
    if ((await form.getAttribute("open")) === null) await page.getByText("Nueva mesa en Comedor").click();
    await form.getByLabel("Nombre de la mesa").fill(name);
    await form.getByLabel("Máximo").fill(max);
    await form.getByRole("button", { name: "Crear mesa" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^Mesa ${name},`) })).toBeVisible();
  }
  await expect(page.getByText("2 mesas activas · 6 plazas")).toBeVisible();

  const plan = page.getByRole("group", { name: "Plano de Comedor" });
  const m1 = plan.getByRole("button", { name: /^Mesa M1,/ });
  const m2 = plan.getByRole("button", { name: /^Mesa M2,/ });
  expect(await cellOf(m1, 10, 6)).toEqual({ x: 0, y: 0 });
  expect(await cellOf(m2, 10, 6)).toEqual({ x: 2, y: 0 });

  // Arrastrar M1 a (5, 3) y comprobar que persiste.
  let saved = serverActionDone(page);
  await dragTo(page, plan, m1, 5, 3, 10, 6);
  expect(await cellOf(m1, 10, 6)).toEqual({ x: 5, y: 3 });
  await saved;
  await page.reload();
  expect(await cellOf(plan.getByRole("button", { name: /^Mesa M1,/ }), 10, 6)).toEqual({ x: 5, y: 3 });

  // Teclado: M2 una celda a la derecha.
  await plan.getByRole("button", { name: /^Mesa M2,/ }).focus();
  saved = serverActionDone(page);
  await page.keyboard.press("ArrowRight");
  await saved;
  await page.reload();
  expect(await cellOf(plan.getByRole("button", { name: /^Mesa M2,/ }), 10, 6)).toEqual({ x: 3, y: 0 });

  // Soltar M2 encima de M1: el servidor lo rechaza y la mesa vuelve a su sitio.
  await dragTo(page, plan, plan.getByRole("button", { name: /^Mesa M2,/ }), 5, 3, 10, 6);
  await expect(page.getByText("La mesa se solapa con otra en el plano")).toBeVisible();
  expect(await cellOf(plan.getByRole("button", { name: /^Mesa M2,/ }), 10, 6)).toEqual({ x: 3, y: 0 });
  await page.reload();
  expect(await cellOf(plan.getByRole("button", { name: /^Mesa M2,/ }), 10, 6)).toEqual({ x: 3, y: 0 });

  const floorUrl = page.url();
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Vecino");
  expect((await other.goto(floorUrl))?.status()).toBe(404);
  await otherCtx.close();
});
