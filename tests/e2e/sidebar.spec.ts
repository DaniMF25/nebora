import { expect, test } from "@playwright/test";
import { createOrganization, navLink, register } from "./helpers";

// Menú lateral: Gestión y Organización plegables en acordeón y la cuenta siempre a la vista.
test("menú lateral: acordeón de Gestión y Organización, abierto el de la página actual, cuenta fija abajo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await register(page, "Menu");
  const org = await createOrganization(page, "Casa Menu", "pro");
  const nav = page.getByRole("navigation", { name: "Secciones de la organización" });
  const section = (name: string) => nav.locator("details.side-section", { hasText: name });

  // En Inicio, ambos grupos cerrados.
  await expect(section("Gestión")).not.toHaveAttribute("open");
  await expect(section("Organización")).not.toHaveAttribute("open");
  await expect(nav.getByRole("link", { name: "Productos" })).toBeHidden();

  // Abrir uno cierra el otro.
  await section("Gestión").locator("summary").click();
  await expect(nav.getByRole("link", { name: "Productos" })).toBeVisible();
  await section("Organización").locator("summary").click();
  await expect(nav.getByRole("link", { name: "Miembros" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Productos" })).toBeHidden();

  // En una página de un grupo, ese grupo está abierto y el enlace marcado.
  await (await navLink(page, "Proveedores")).click();
  await expect(page).toHaveURL(`${org}/suppliers`);
  await expect(nav.getByRole("link", { name: "Proveedores" })).toHaveAttribute("aria-current", "page");
  await expect(section("Organización")).not.toHaveAttribute("open");

  // Con las dos abiertas a la vez no cabría: la cuenta y «Cerrar sesión» siguen visibles en una pantalla baja.
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Crear otra organización" })).toBeInViewport();
  // Teclado: el resumen del grupo se abre con Enter.
  await section("Organización").locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("link", { name: "Plan" })).toBeVisible();
});
