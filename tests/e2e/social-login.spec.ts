import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Inicio de sesión con Google, Apple y Facebook (D-061). El servidor de pruebas
// tiene credenciales de prueba: se comprueba el inicio del flujo y que la vuelta
// exige el intento de este navegador; nunca se contacta con los proveedores.
test("acceso con proveedores: botones, inicio del flujo y vuelta solo con el intento de este navegador", async ({
  page,
}) => {
  await page.goto("/login");
  for (const p of ["Google", "Apple", "Facebook"]) {
    await expect(page.getByRole("link", { name: `Continuar con ${p}` })).toBeVisible();
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.goto("/register");
  await expect(page.getByRole("link", { name: "Continuar con Google" })).toBeVisible();

  // Empezar con Google: redirige a Google con state, nonce y PKCE, y guarda el intento en una cookie HttpOnly.
  const start = await page.request.get("/auth/google/start?next=/app", { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const location = new URL(start.headers()["location"]!);
  expect(location.origin).toBe("https://accounts.google.com");
  expect(location.searchParams.get("client_id")).toBe("e2e-google-client");
  expect(location.searchParams.get("redirect_uri")).toMatch(/\/auth\/google\/callback$/);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  const state = location.searchParams.get("state")!;
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const cookie = start.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")!.value;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=lax/i);

  // Apple vuelve con un POST desde su dominio: su cookie va con SameSite=None y Secure.
  const apple = await page.request.get("/auth/apple/start", { maxRedirects: 0 });
  expect(new URL(apple.headers()["location"]!).searchParams.get("response_mode")).toBe("form_post");
  const appleCookie = apple.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")!.value;
  expect(appleCookie).toMatch(/SameSite=none/i);
  expect(appleCookie).toMatch(/Secure/i);

  // Vuelta con otro state (p. ej. un enlace preparado por otra persona): rechazada, sin sesión.
  await page.request.get("/auth/google/start", { maxRedirects: 0 });
  await page.goto("/auth/google/callback?state=otro-state-que-no-es-el-mio&code=x");
  await expect(page).toHaveURL(/\/login\?error=invalid_state$/);
  await expect(page.locator("main [role=alert]")).toContainText("El inicio de sesión ha caducado o no es válido");
  // Un state de un intento anterior (sustituido o ya usado) tampoco vale: cada intento sirve una vez.
  await page.goto(`/auth/google/callback?state=${state}&code=x`);
  await expect(page).toHaveURL(/error=invalid_state$/);
  // Sin sesión abierta.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);

  // Proveedor desconocido: 404. Un ?error= inventado no se muestra.
  expect((await page.request.get("/auth/twitter/start", { maxRedirects: 0 })).status()).toBe(404);
  await page.goto("/login?error=%3Cscript%3E");
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});
