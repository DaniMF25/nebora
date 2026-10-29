import { expect, test, type Page } from "@playwright/test";
import { register, suffix } from "./helpers";

// Safari en iPhone amplía la página al entrar en un campo con letra de menos de 16 px.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function smallFields(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter(
        (el) =>
          el.getBoundingClientRect().width > 0 &&
          (el as HTMLInputElement).type !== "checkbox" &&
          (el as HTMLInputElement).type !== "radio",
      )
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.getAttribute("name") ?? el.getAttribute("aria-label")}: ${getComputedStyle(el).fontSize}`),
  );
}

test("en móvil los campos tienen al menos 16 px para que el navegador no amplíe la página", async ({ page }) => {
  await page.goto("/register");
  expect(await smallFields(page)).toEqual([]);
  await register(page, "Zoom");
  await page.getByLabel("Nombre").fill("Casa Zoom");
  await page.getByLabel("Identificador (URL)").fill(`zoom-${suffix()}`);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Zoom" })).toBeVisible();
  expect(await smallFields(page)).toEqual([]);
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  await page.goto(`${page.url()}?tab=horario`);
  await page.getByLabel("Lunes abierto").check();
  expect(await smallFields(page)).toEqual([]);
});
