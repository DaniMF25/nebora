// Capturas reales del panel y de la web de un restaurante para la web pública
// de Nébora (D-064). Crea un restaurante de ejemplo en la base de datos de E2E
// (`nebora_e2e`, que se recrea desde cero), lo fotografía con el Chromium del
// sistema y guarda las imágenes WebP en public/marketing/.
//
// Requiere `next build` y las variables de .env.local. Uso:
//   pnpm marketing:screenshots
// Solo para entornos locales: nunca contra producción.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

const PORT = "3200";
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(import.meta.dirname, "../public/marketing");
const EMAIL = `marta-${Date.now()}@example.test`;
const PASSWORD = "contraseña-de-ejemplo-larga";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.NEBORA_APP_DB_PASSWORD;
if (!adminUrl || !appPassword) throw new Error("Faltan DATABASE_ADMIN_URL o NEBORA_APP_DB_PASSWORD");

// 1. Servidor de E2E (recrea nebora_e2e y arranca next start).
const server = spawn("npx", ["tsx", "--env-file-if-exists=.env.local", "scripts/e2e-server.ts"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, E2E_PORT: PORT },
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);
process.on("uncaughtException", (err) => {
  console.error(err);
  stop();
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(err);
  stop();
  process.exit(1);
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).ok) break;
  } catch {}
  if (i > 120) throw new Error("El servidor no arrancó");
  await new Promise((r) => setTimeout(r, 1000));
}

// 2. Datos de ejemplo con los servicios de la aplicación (mismas reglas que el panel).
const appUrl = new URL(adminUrl);
appUrl.pathname = "/nebora_e2e";
appUrl.username = "nebora_app";
appUrl.password = encodeURIComponent(appPassword);
process.env.DATABASE_URL = appUrl.toString();

const { registerUser } = await import("@/server/auth/service");
const { withTenant, withUser } = await import("@/server/tenancy/context");
const { createOrganization, changePlan } = await import("@/server/modules/organizations/service");
const { createEstablishment } = await import("@/server/modules/establishments/service");
const { setWeeklyHours } = await import("@/server/modules/schedules/service");
const { createProduct } = await import("@/server/modules/menus/products");
const { createMenu, addSection, addItem, publishMenu, setItemRecommended } = await import("@/server/modules/menus/menus");
const { updateSiteProfile, setSitePublished, setSiteTheme, setSiteBranding, setSiteDecor } = await import("@/server/modules/site/service");
const { createStory } = await import("@/server/modules/site/stories");
const { createZone, createTable, moveTable } = await import("@/server/modules/floor/service");
const { createReservation } = await import("@/server/modules/reservations/service");
const { updateReservationSettings } = await import("@/server/modules/reservations/settings");
const { createStaffMember, createShift } = await import("@/server/modules/staff/service");
const { createIngredient, updateIngredient, createWarehouse, recordMovement } = await import(
  "@/server/modules/inventory/service"
);
const { setRecipeLine } = await import("@/server/modules/recipes/service");
const { createSupplier, createOrder, setOrderLine, markOrderSent } = await import("@/server/modules/purchasing/service");

const tz = "Europe/Madrid";
const localDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + offsetDays * 86_400_000));
const today = localDate();
// Lunes de esta semana (para el cuadrante).
const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
const weekDay = (i: number) => localDate(i - dow);

const user = await registerUser({ email: EMAIL, displayName: "Marta Llorens", password: PASSWORD }, { allowSignup: true });
const orgId = await withUser(user, (tx, ctx) => createOrganization(tx, ctx, { name: "Grupo La Lonja", slug: "la-lonja" }));
const ids = await withTenant(user, orgId, async (tx, ctx) => {
  // Plan elegido: sin el aviso de la prueba en las capturas.
  await changePlan(tx, ctx, { plan: "pro" });
  const est = await createEstablishment(tx, ctx, { name: "La Lonja del Puerto", slug: "puerto" });
  const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
    { weekday, opens: "13:00", closes: "16:30" },
    { weekday, opens: "20:00", closes: "23:59" },
  ]);
  await setWeeklyHours(tx, ctx, est.id, { slots });

  // Cocina: ingredientes con coste, almacén y stock.
  const ing = async (name: string, baseUnit: "g" | "ml" | "unit", cost: string, reorderLevel?: string) => {
    const i = await createIngredient(tx, ctx, { name, baseUnit, ...(reorderLevel ? { reorderLevel } : {}) });
    await updateIngredient(tx, ctx, i.id, { cost });
    return i.id;
  };
  const leche = await ing("Leche entera", "ml", "1,05", "6000");
  const harina = await ing("Harina de trigo", "g", "0,90", "5000");
  const jamon = await ing("Jamón ibérico", "g", "48,00", "1000");
  const arroz = await ing("Arroz bomba", "g", "3,40", "10000");
  const gamba = await ing("Gamba roja", "g", "38,00", "2000");
  const aove = await ing("Aceite de oliva virgen extra", "ml", "7,20", "5000");
  const queso = await ing("Queso crema", "g", "9,80");
  const huevos = await ing("Huevos camperos", "unit", "0,32", "60");
  const camara = await createWarehouse(tx, ctx, est.id, { name: "Cámara" });
  const despensa = await createWarehouse(tx, ctx, est.id, { name: "Despensa" });
  const receive = (warehouseId: string, ingredientId: string, quantity: string, unit: string) =>
    recordMovement(tx, ctx, { warehouseId, ingredientId, kind: "receipt", quantity, unit, idempotencyKey: randomUUID() });
  await receive(camara, leche, "12", "l");
  await receive(despensa, harina, "8", "kg");
  await receive(camara, jamon, "0,6", "kg");
  await receive(despensa, arroz, "18", "kg");
  await receive(camara, gamba, "3,5", "kg");
  await receive(despensa, aove, "4", "l");
  await receive(camara, queso, "2", "kg");
  await receive(camara, huevos, "90", "unit");

  const supplier = await createSupplier(tx, ctx, { name: "Pescados Mari Carmen", email: "pedidos@pescadosmc.example" });
  await createSupplier(tx, ctx, { name: "Distribuciones Albufera" });
  const order = await createOrder(tx, ctx, { supplierId: supplier.id, warehouseId: camara, expectedDate: localDate(1) });
  await setOrderLine(tx, ctx, order, { ingredientId: gamba, quantity: "4", unit: "kg", unitPrice: "38,00" });
  await markOrderSent(tx, ctx, order);

  // Carta.
  const product = (name: string, euros: number, description: string, allergens: string[] = []) =>
    createProduct(tx, ctx, { name, priceCents: Math.round(euros * 100), description, allergens });
  const croquetas = await product("Croquetas de jamón ibérico", 9.5, "Bechamel de leche fresca, seis unidades.", [
    "gluten",
    "milk",
    "eggs",
  ]);
  const ensaladilla = await product("Ensaladilla de la casa", 8, "Con ventresca de bonito y piparras.", ["eggs", "fish"]);
  const gambas = await product("Gamba roja a la plancha", 19, "De la lonja de Dénia, con sal gruesa.", ["crustaceans"]);
  const arrozSenyoret = await product("Arroz del senyoret", 18.5, "Mínimo dos personas. Precio por persona.", [
    "crustaceans",
    "molluscs",
    "fish",
  ]);
  const arrozNegro = await product("Arroz negro con alioli", 17, "Con sepia y su tinta.", ["molluscs", "eggs"]);
  const lubina = await product("Lubina a la sal", 22, "Pieza entera, para compartir.", ["fish"]);
  const tarta = await product("Tarta de queso al horno", 6.5, "Cremosa, con galleta de mantequilla.", [
    "milk",
    "eggs",
    "gluten",
  ]);
  const torrija = await product("Torrija caramelizada", 6, "Con helado de vainilla.", ["milk", "eggs", "gluten"]);
  for (const [ingredientId, quantity, unit] of [
    [leche, "250", "ml"],
    [harina, "60", "g"],
    [jamon, "45", "g"],
    [huevos, "1", "unit"],
    [aove, "30", "ml"],
  ] as const) {
    await setRecipeLine(tx, ctx, croquetas.id, { ingredientId, quantity, unit });
  }
  for (const [ingredientId, quantity, unit] of [
    [arroz, "100", "g"],
    [gamba, "80", "g"],
    [aove, "25", "ml"],
  ] as const) {
    await setRecipeLine(tx, ctx, arrozSenyoret.id, { ingredientId, quantity, unit });
  }
  for (const [ingredientId, quantity, unit] of [
    [queso, "90", "g"],
    [huevos, "1", "unit"],
    [harina, "10", "g"],
  ] as const) {
    await setRecipeLine(tx, ctx, tarta.id, { ingredientId, quantity, unit });
  }
  const menu = await createMenu(tx, ctx, est.id, { name: "Carta", slug: "carta", theme: "moderno" });
  const sections: [string, { id: string }[]][] = [
    ["Para empezar", [croquetas, ensaladilla, gambas]],
    ["Arroces", [arrozSenyoret, arrozNegro]],
    ["Del mar", [lubina]],
    ["Postres", [tarta, torrija]],
  ];
  for (const [name, products] of sections) {
    const section = await addSection(tx, ctx, menu.id, { name });
    for (const p of products) {
      const item = await addItem(tx, ctx, menu.id, section, { productId: p.id });
      if (p === arrozSenyoret || p === croquetas) await setItemRecommended(tx, ctx, menu.id, item, { recommended: true });
    }
  }
  await publishMenu(tx, ctx, menu.id);

  // Web con historia y reservas online.
  await setSiteTheme(tx, ctx, est.id, { theme: "moderno" });
  await setSiteBranding(tx, ctx, est.id, { accentColor: "#1f5f8b", fontPairing: null });
  await setSiteDecor(tx, ctx, est.id, { decor: "seafood" });
  await updateSiteProfile(tx, ctx, est.id, {
    theme: "moderno",
    tagline: "Arroces y pescado de lonja desde 1987",
    heroEyebrow: "Puerto de Dénia",
    heroTitle: "Cocina de puerto, sin prisas",
    heroText: "Pescado que llega cada mañana de la lonja, arroces a leña y una terraza frente a los barcos.",
    phone: "+34 965 00 00 00",
    whatsapp: "",
    instagram: "lalonjadelpuerto",
    highlights: [
      { icon: "fish", title: "Pescado de lonja", text: "Compramos cada mañana a los barcos del puerto." },
      { icon: "fire", title: "Arroces a leña", text: "Paella fina de hierro, al punto de socarrat." },
      { icon: "sun", title: "Terraza", text: "Frente al puerto, también en invierno." },
    ],
    featuredMenuId: menu.id,
  });
  await updateReservationSettings(tx, ctx, est.id, {
    publicEnabled: true,
    minParty: 1,
    maxParty: 10,
    durationMinutes: 105,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 60,
    maxDaysAhead: 60,
    autoConfirm: true,
  });
  await setSitePublished(tx, ctx, est.id, { published: true });
  await createStory(tx, ctx, est.id, {
    title: "Ya abrimos la terraza",
    body: "Cenas frente al puerto de jueves a domingo.",
    ctaKind: "booking",
    ctaLabel: "",
    ctaUrl: "",
    startsOn: "",
    endsOn: "",
  });

  // Sala y reservas de hoy.
  const salon = await createZone(tx, ctx, est.id, { name: "Salón", planWidth: 16, planHeight: 9 });
  const terraza = await createZone(tx, ctx, est.id, { name: "Terraza", planWidth: 16, planHeight: 5 });
  const tables: string[] = [];
  for (const [zone, name, max, shape, x, y, w, h] of [
    [salon, "S1", 2, "square", 1, 1, 2, 2],
    [salon, "S2", 2, "square", 4, 1, 2, 2],
    [salon, "S3", 4, "round", 8, 1, 2, 2],
    [salon, "S4", 4, "round", 12, 1, 2, 2],
    [salon, "S5", 8, "rectangle", 1, 5, 5, 2],
    [salon, "S6", 4, "square", 8, 5, 2, 2],
    [salon, "B1", 2, "round", 12, 5, 2, 2],
    [terraza, "T1", 4, "round", 1, 1, 2, 2],
    [terraza, "T2", 4, "round", 5, 1, 2, 2],
    [terraza, "T3", 2, "square", 9, 1, 2, 2],
    [terraza, "T4", 2, "square", 12, 1, 2, 2],
  ] as const) {
    const t = await createTable(tx, ctx, zone, { name, maxCapacity: max, shape, width: w, height: h });
    await moveTable(tx, ctx, t.id, { x, y });
    tables.push(t.id);
  }
  // Las mismas reservas que la demo del plano en la portada (src/components/marketing/demo-data.ts).
  const bookings: [string, number, string, string, number, string][] = [
    ["13:30", 2, "Elena Ferrer", "+34 611 234 567", 0, ""],
    ["14:00", 4, "Familia Soler", "+34 622 345 678", 2, "Trona para un bebé"],
    ["14:15", 6, "Comida de empresa", "+34 633 456 789", 4, "Menú cerrado acordado"],
    ["14:30", 2, "Jordi Martí", "", 1, ""],
    ["20:30", 2, "Marta y Joan", "+34 677 890 123", 9, ""],
    ["21:00", 4, "Lucía Romero", "+34 644 567 890", 7, "Celiaca: sin gluten"],
    ["21:00", 4, "Grupo Iborra", "+34 666 789 012", 3, ""],
    ["21:30", 2, "Pablo y Ana", "+34 655 678 901", 10, "Aniversario"],
    ["22:00", 3, "Hugo Navarro", "+34 688 901 234", 5, ""],
  ];

  for (const [time, partySize, customerName, customerPhone, table, notes] of bookings) {
    await createReservation(tx, ctx, est.id, {
      date: today,
      time,
      durationMinutes: 105,
      partySize,
      customerName,
      customerPhone,
      notes,
      tableIds: [tables[table]!],
    });
  }

  // Equipo y cuadrante de esta semana.
  const people: [string, string, [string, string][]][] = [
    ["Carmen Vidal", "Jefa de cocina", [["10:00", "16:30"], ["10:00", "16:30"], ["", ""], ["10:00", "16:30"], ["18:30", "23:59"], ["10:00", "16:30"], ["10:00", "16:30"]]],
    ["Iván Moreno", "Cocina", [["18:30", "23:59"], ["", ""], ["18:30", "23:59"], ["18:30", "23:59"], ["10:00", "16:30"], ["18:30", "23:59"], ["", ""]]],
    ["Laura Gil", "Sala", [["12:30", "16:30"], ["12:30", "16:30"], ["12:30", "16:30"], ["", ""], ["19:30", "23:59"], ["19:30", "23:59"], ["12:30", "16:30"]]],
    ["Sergi Pastor", "Sala", [["", ""], ["19:30", "23:59"], ["19:30", "23:59"], ["19:30", "23:59"], ["12:30", "16:30"], ["12:30", "16:30"], ["19:30", "23:59"]]],
    ["Nora Ruiz", "Barra", [["19:00", "23:59"], ["19:00", "23:59"], ["", ""], ["19:00", "23:59"], ["19:00", "23:59"], ["12:00", "16:30"], ["12:00", "16:30"]]],
  ];
  for (const [name, position, week] of people) {
    const member = await createStaffMember(tx, ctx, { name, position, userId: "" });
    for (const [i, [start, end]] of week.entries()) {
      if (!start) continue;
      await createShift(tx, ctx, est.id, { staffMemberId: member.id, date: weekDay(i), start, end, position: "", notes: "" });
    }
  }
  return { est: est.id, menu: menu.id, croquetas: croquetas.id };
});

// 3. Capturas.
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
);
async function shoot(
  page: Page,
  url: string,
  name: string,
  width: number,
  opts: { selector?: string; scrollTo?: string; height?: number; keepStory?: boolean } = {},
) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  // Las historias se abren solas la primera vez: para la captura, cerradas.
  if (!opts.keepStory && (await page.getByRole("dialog").isVisible())) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  if (opts.scrollTo) {
    await page.getByRole("heading", { name: opts.scrollTo }).evaluate((el) => {
      el.closest("section")?.scrollIntoView();
      window.scrollBy(0, -32);
    });
    await page.waitForTimeout(200);
  }
  const viewport = page.viewportSize()!;
  const png = opts.selector
    ? await page.locator(opts.selector).first().screenshot()
    : await page.screenshot(opts.height ? { clip: { x: 0, y: 0, width: viewport.width, height: opts.height } } : {});
  await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(OUT, `${name}.webp`));
  console.log(`  ${name}.webp`);
}
const panel = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await panel.goto(`${BASE}/login`);
await panel.getByLabel("Correo electrónico").fill(EMAIL);
await panel.getByLabel("Contraseña").fill(PASSWORD);
await panel.getByRole("button", { name: "Entrar" }).click();
await panel.waitForURL(/\/app\//);
const org = `/app/${orgId}`;
const est = `${org}/establishments/${ids.est}`;
await shoot(panel, org, "panel-inicio", 1600, { height: 585 });
await shoot(panel, `${est}/reservations?date=${today}`, "panel-reservas", 1600);
await shoot(panel, `${est}/floor`, "panel-sala", 1600);
await shoot(panel, `${est}/staff`, "panel-turnos", 1600);
await shoot(panel, `${org}/products/${ids.croquetas}`, "panel-escandallo", 1600, { scrollTo: "Escandallo (por ración)" });
await shoot(panel, `${est}/inventory`, "panel-stock", 1600);

// La web del restaurante, en el móvil de un cliente (sin sesión).
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await shoot(phone, "/la-lonja/puerto", "web-portada", 780);
await shoot(phone, "/m/la-lonja/puerto/carta", "web-carta", 780);
// Con la historia abierta, como la ve un cliente la primera vez.
const fresh = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await fresh.goto(`${BASE}/la-lonja/puerto`);
await fresh.getByRole("dialog").waitFor();
await fresh.waitForTimeout(2500);
await sharp(await fresh.screenshot()).resize({ width: 780 }).webp({ quality: 82 }).toFile(path.join(OUT, "web-historia.webp"));
console.log("  web-historia.webp");
await browser.close();
stop();
process.exit(0);
