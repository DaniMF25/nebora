import { expect, test } from "@playwright/test";
import { createOrganization, PASSWORD, register, suffix } from "./helpers";

test("invitar a una persona: crea su cuenta con el enlace y entra en la organización", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Dueña");
  const orgUrl = await createOrganization(owner, "Casa Invitada");

  await owner.getByRole("link", { name: "Miembros" }).click();
  const inviteeEmail = `nuevo-${suffix()}@example.test`;
  await owner.getByLabel("Correo electrónico").fill(inviteeEmail);
  await owner.getByLabel("Rol").selectOption("manager");
  await owner.getByRole("button", { name: "Crear invitación" }).click();
  const link = await owner.getByLabel("Enlace de invitación").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  // Otra persona con sesión iniciada y otro correo no puede aceptarla.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other, "Ajena");
  await other.goto(link);
  await expect(other.getByText(/Cierra sesión y entra con/)).toBeVisible();
  await expect(other.getByRole("button", { name: "Aceptar invitación" })).toHaveCount(0);

  // La persona invitada crea su cuenta desde el enlace (el registro público no hace falta).
  const inviteeCtx = await browser.newContext();
  const invitee = await inviteeCtx.newPage();
  const res = await invitee.goto(link);
  expect(res?.headers()["referrer-policy"]).toBeDefined();
  await expect(invitee.getByText(inviteeEmail)).toBeVisible();
  await invitee.getByLabel("Nombre").fill("Nuevo Encargado");
  await invitee.getByLabel(/Contraseña/).fill(PASSWORD);
  await invitee.getByRole("button", { name: "Crear cuenta y unirme" }).click();
  await expect(invitee).toHaveURL(orgUrl);
  await expect(invitee.getByRole("heading", { level: 1, name: "Casa Invitada" })).toBeVisible();

  // El enlace ya no sirve.
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "Invitación no válida" })).toBeVisible();

  // La propietaria ve al nuevo miembro con su rol.
  await owner.reload();
  const row = owner.getByRole("row", { name: /Nuevo Encargado/ });
  await expect(row).toContainText("Encargado");

  await ownerCtx.close();
  await otherCtx.close();
  await inviteeCtx.close();
});

test("el login con ?next= no permite redirigir fuera del sitio", async ({ page }) => {
  const email = await register(page, "Redir");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.goto("/login?next=//evil.example/robar");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/app$/);
});
