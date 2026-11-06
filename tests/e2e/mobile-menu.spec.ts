import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Menú del panel en el móvil: no tapa «Inicio», no desplaza la página de detrás y se pulsa bien con el dedo.
test("menú del panel en móvil: bajo la barra superior, sin desplazar el fondo y con zonas táctiles de 44 px", async ({
  page,
}) => {
  await register(page, "Menu");
  await page.getByLabel("Nombre del negocio").fill("Pitapes");
  await page.getByRole("button", { name: "Crear organización" }).click();
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  await page.getByLabel("Nombre").first().fill("Pitapes");
  await page.getByLabel("Identificador (URL)").fill(`pitapes-${Date.now()}`);
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  const scrolled = await page.evaluate(() => window.scrollY);

  await page.getByRole("button", { name: "Abrir menú" }).click();
  const m = await page.evaluate(() => {
    const bar = document.querySelector(".panel-topbar")!.getBoundingClientRect();
    const first = document.querySelector(".side-nav a")!.getBoundingClientRect();
    const targets = [...document.querySelectorAll(".side-nav a, .side-section > summary")].map(
      (e) => e.getBoundingClientRect().height,
    );
    return { barTop: bar.top, barBottom: bar.bottom, firstTop: first.top, minTarget: Math.min(...targets) };
  });
  expect(m.barTop).toBe(0);
  expect(m.firstTop).toBeGreaterThanOrEqual(m.barBottom);
  expect(m.minTarget).toBeGreaterThanOrEqual(44);

  // Desplazar con el menú abierto no mueve la página de detrás.
  await page.mouse.move(200, 600);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

  // Al cerrarlo, la página vuelve a desplazarse.
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
});
