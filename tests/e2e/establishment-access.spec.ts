import { expect, test } from "@playwright/test";
import { createOrganization, PASSWORD, register, suffix } from "./helpers";

test("miembro limitado a un local: solo ve ese local y el acceso se puede cambiar", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Dueño");
  const orgUrl = await createOrganization(owner, "Grupo Acceso");
  for (const name of ["Centro", "Playa"]) {
    await owner.getByLabel("Nombre").fill(name);
    await owner.getByLabel("Identificador (URL)").fill(`${name.toLowerCase()}-${suffix()}`);
    await owner.getByRole("button", { name: "Crear establecimiento" }).click();
    await expect(owner.getByRole("main").getByRole("link", { name })).toBeVisible();
  }
  const centroUrl = new URL(
    (await owner.getByRole("main").getByRole("link", { name: "Centro" }).getAttribute("href"))!,
    owner.url(),
  ).toString();

  // Invitación de personal solo para Playa.
  await owner.getByRole("link", { name: "Miembros" }).click();
  const email = `camarera-${suffix()}@example.test`;
  await owner.getByLabel("Correo electrónico").fill(email);
  await owner.getByLabel("Rol").selectOption("staff");
  await owner.getByLabel("Solo estos locales:").check();
  await owner.getByLabel("Playa").check();
  await owner.getByRole("button", { name: "Crear invitación" }).click();
  const link = await owner.getByLabel("Enlace de invitación").inputValue();
  await owner.reload();
  await expect(owner.getByText(`${email} · Personal · locales: Playa`)).toBeVisible();

  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await staff.goto(link);
  await staff.getByLabel("Nombre").fill("Camarera Playa");
  await staff.getByLabel(/Contraseña/).fill(PASSWORD);
  await staff.getByRole("button", { name: "Crear cuenta y unirme" }).click();
  await expect(staff).toHaveURL(orgUrl);
  const main = staff.getByRole("main");
  await expect(main.getByRole("link", { name: "Playa" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Centro" })).toHaveCount(0);
  const nav = staff.getByRole("navigation", { name: "Secciones de la organización" });
  await expect(nav.getByRole("group", { name: "Local: Playa" })).toBeVisible();
  await expect(nav.getByText("Centro")).toHaveCount(0);
  // Ni con la dirección directa.
  expect((await staff.goto(centroUrl))?.status()).toBe(404);
  expect((await staff.goto(`${centroUrl}/reservations`))?.status()).toBe(404);

  // El propietario la pasa a Centro.
  await owner.reload();
  const row = owner.getByRole("row", { name: /Camarera Playa/ });
  await expect(row).toContainText("Playa");
  await row.getByText("Locales de Camarera Playa").click();
  await row.getByLabel("Playa", { exact: true }).uncheck();
  await row.getByLabel("Centro", { exact: true }).check();
  await row.getByRole("button", { name: "Guardar locales" }).click();
  await expect(row.getByText("Acceso actualizado")).toBeVisible();

  await staff.goto(orgUrl);
  await expect(main.getByRole("link", { name: "Centro" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Playa" })).toHaveCount(0);
  expect((await staff.goto(centroUrl))?.status()).toBe(200);

  await ownerCtx.close();
  await staffCtx.close();
});
