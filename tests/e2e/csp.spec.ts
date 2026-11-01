import { expect, test, type Page } from "@playwright/test";
import { openTab, register, setSitePublished, suffix } from "./helpers";

/** Recoge las violaciones de CSP que el navegador notifica en la página. */
async function watchViolations(page: Page): Promise<string[]> {
  const found: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) found.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return found;
}

// CSP con nonce por petición (D-044).
test("CSP estricta: solo scripts con nonce y la aplicación funciona sin violaciones", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  const violations = await watchViolations(page);

  const res = await page.goto("/login");
  const csp = res!.headers()["content-security-policy"]!;
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).not.toMatch(/'unsafe-eval'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(res!.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  // Por http (local) no se fuerza HTTPS: HSTS ni upgrade-insecure-requests.
  expect(res!.headers()["strict-transport-security"]).toBeUndefined();
  expect(csp).not.toContain("upgrade-insecure-requests");
  // Cada petición, un nonce distinto; y los scripts de la página llevan el de su respuesta.
  const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
  const again = (await page.goto("/login"))!.headers()["content-security-policy"]!;
  expect(/'nonce-([^']+)'/.exec(again)![1]).not.toBe(nonce);
  const scriptNonces = await page
    .locator("script")
    .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([/'nonce-([^']+)'/.exec(again)![1]]));

  // Control: un manejador en línea inyectado se bloquea y el detector lo registra.
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "inyectado";
    b.setAttribute("onclick", "document.title = 'XSS'");
    document.body.append(b);
  });
  await page.locator("#inyectado").click();
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(await page.title()).not.toBe("XSS");
  violations.length = 0;

  // Panel: los componentes interactivos solo funcionan si sus scripts se cargan.
  await register(page, "Csp");
  const orgSlug = `csp-${suffix()}`;
  await page.getByLabel("Nombre").fill("Casa Csp");
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Csp" })).toBeVisible();
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();
  await openTab(page, "Horario");
  await page.getByLabel("Lunes abierto").check();
  await expect(page.getByLabel("Lunes, turno 1, apertura")).toBeVisible(); // lo pinta el componente cliente

  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await setSitePublished(page, true);
  await page.goto(`${est}/site?tab=estilo`);

  // Web pública y menú móvil (componente cliente).
  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const publicViolations = await watchViolations(visitor);
  await visitor.goto(`/${orgSlug}/puerto`);
  await expect(visitor.getByRole("heading", { level: 1, name: "Bienvenidos" })).toBeVisible();
  await visitor.waitForLoadState("networkidle");

  expect(violations, violations.join("\n")).toEqual([]);
  expect(publicViolations, publicViolations.join("\n")).toEqual([]);
});
