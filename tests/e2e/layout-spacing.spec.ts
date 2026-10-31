import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { PASSWORD, register, suffix } from "./helpers";

/**
 * Botones pegados: recorre las páginas del panel con datos reales y comprueba
 * que ningún par de botones visibles queda a menos de MIN_GAP píxeles (en la
 * misma fila o en la misma columna) ni desalineado con su vecino de fila.
 * Abre antes los desplegables. Los planos
 * de sala se excluyen: sus mesas son botones colocados en una cuadrícula.
 */
const MIN_GAP = 6;

async function touchingButtons(page: Page): Promise<string[]> {
  return page.evaluate((minGap) => {
    document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true));
    const name = (el: Element) =>
      (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const buttons = [...document.querySelectorAll("button, input[type=submit]")]
      .filter((el) => !el.closest('[role="group"][aria-label^="Plano de"]'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden");
    const out: string[] = [];
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i]!;
        const b = buttons[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const hGap = Math.max(b.r.left - a.r.right, a.r.left - b.r.right);
        const vGap = Math.max(b.r.top - a.r.bottom, a.r.top - b.r.bottom);
        const sameRow = vGap < 0;
        const sameColumn = hGap < 0;
        if ((sameRow && hGap < minGap) || (sameColumn && vGap < minGap)) {
          out.push(`«${name(a.el)}» y «${name(b.el)}» (separación ${Math.round(Math.max(hGap, vGap))} px)`);
        }
        // Botones vecinos en la misma fila: a la misma altura.
        const dy = Math.abs(a.r.top + a.r.height / 2 - (b.r.top + b.r.height / 2));
        if (sameRow && hGap >= 0 && hGap < 40 && dy > 2) {
          out.push(`«${name(a.el)}» y «${name(b.el)}» desalineados (${Math.round(dy)} px)`);
        }
      }
    }
    return out;
  }, MIN_GAP);
}

/**
 * Desbordamientos en móvil: la página no debe tener scroll horizontal ni
 * elementos que salgan de la pantalla, de su tarjeta o queden recortados. En
 * el panel tampoco se admite contenido que haya que desplazar en horizontal
 * dentro de la página (tablas, pestañas), salvo el plano de sala.
 */
async function overflowIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true));
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.classList.length ? `.${[...el.classList].join(".")}` : "";
      const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` «${text}»` : ""}`;
    };
    if (document.documentElement.scrollWidth > vw + 1) {
      out.push(`la página se desplaza en horizontal (${document.documentElement.scrollWidth} > ${vw} px)`);
    }
    const scrollers = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };
    const outside: Element[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.position === "fixed") continue;
      if (el.closest('[aria-hidden="true"], .visually-hidden, svg')) continue;
      // Oculto visualmente con clip (solo para lectores de pantalla), como la cabecera de las tablas en móvil.
      let clipped = false;
      for (let q: Element | null = el; q && !clipped; q = q.parentElement)
        clipped = getComputedStyle(q).clip !== "auto";
      if (clipped) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrollers(el)) outside.push(el);
      // Dentro del panel: nada se sale de su tarjeta (sección).
      const card = el.parentElement?.closest(".panel-main section");
      if (card && !scrollers(el)) {
        const c = card.getBoundingClientRect();
        if (r.right > c.right + 1 || r.left < c.left - 1) outside.push(el);
      }
      // Las imágenes del panel caben en su contenedor (p. ej. muestras del logotipo).
      if (el.tagName === "IMG" && el.closest(".panel-main") && el.parentElement) {
        const b = el.parentElement.getBoundingClientRect();
        if (r.right > b.right + 1 || r.left < b.left - 1) outside.push(el);
      }
      // Ni contenido que haya que desplazar en horizontal (salvo los planos de sala).
      if (
        el.closest(".panel-main") &&
        (st.overflowX === "auto" || st.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.querySelector('[aria-label^="Plano de"], [aria-label^="Ocupación de"]')
      ) {
        out.push(`${describe(el)} obliga a desplazarse en horizontal (${el.scrollWidth} > ${el.clientWidth} px)`);
      }
      // Recortado: contenido más ancho que su caja con el desbordamiento oculto.
      if ((st.overflowX === "hidden" || st.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1) {
        if (st.textOverflow !== "ellipsis")
          out.push(`${describe(el)} recorta su contenido (${el.scrollWidth} > ${el.clientWidth} px)`);
      }
    }
    // Solo el elemento más interno que se sale: sus contenedores se salen por él.
    for (const el of outside) {
      if (outside.some((o) => o !== el && el.contains(o))) continue;
      const r = el.getBoundingClientRect();
      out.push(`${describe(el)} se sale de la pantalla o de su caja (${Math.round(r.left)}–${Math.round(r.right)} px)`);
    }
    // Campos y botones no se montan sobre sus vecinos (p. ej. «de 12:00 a 16:00»).
    for (const el of document.querySelectorAll(".panel-main :is(input, select, textarea, button)")) {
      const r = el.getBoundingClientRect();
      // Una casilla oculta sobre su etiqueta (p. ej. los días de una franja) no es un solape.
      if (r.width === 0 || !el.parentElement || getComputedStyle(el).position === "absolute") continue;
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.contains(el)) continue;
        const o = sib.getBoundingClientRect();
        if (o.width === 0 || o.height === 0 || getComputedStyle(sib).position === "absolute") continue;
        const w = Math.min(r.right, o.right) - Math.max(r.left, o.left);
        const h = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
        if (w > 1 && h > 1) out.push(`${describe(el)} se monta sobre ${describe(sib)}`);
      }
    }
    return [...new Set(out)];
  });
}

test("botones separados y sin desbordamientos en móvil en las páginas del panel", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await register(page, "Espacios");
  await page.getByLabel("Nombre").fill("Casa Espacios");
  const orgSlug = `espacios-${suffix()}`;
  await page.getByLabel("Identificador (URL)").fill(orgSlug);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Casa Espacios" })).toBeVisible();
  const org = new URL(page.url()).pathname;
  await page.getByLabel("Nombre").fill("Puerto");
  await page.getByLabel("Identificador (URL)").fill("puerto");
  await page.getByRole("button", { name: "Crear establecimiento" }).click();
  await page.getByRole("main").getByRole("link", { name: "Puerto" }).click();
  await page.waitForURL(/establishments\/[0-9a-f-]+$/);
  const est = page.url();

  // Datos: horario, productos, carta publicada, inventario, compras, sala, reserva, miembros y web.
  await page.goto(`${est}?tab=horario`);
  await page.getByLabel("Lunes abierto").check();
  await page.getByLabel("Lunes, turno 1, apertura").fill("13:00");
  await page.getByLabel("Lunes, turno 1, cierre").fill("16:00");
  await page.getByRole("button", { name: "Añadir turno en Lunes" }).click();
  await page.getByLabel("Lunes, turno 2, apertura").fill("20:00");
  await page.getByLabel("Lunes, turno 2, cierre").fill("23:30");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado")).toBeVisible();

  for (const name of ["Croquetas", "Pulpo"]) {
    await page.goto(`${org}/products`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Nuevo producto" }) });
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Precio (€)").fill("9");
    await form.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.locator("ul.cards").getByText(name, { exact: true })).toBeVisible();
  }
  await page.goto(`${est}/menus`);
  await page.getByText("Nueva carta").click();
  await page.getByLabel("Nombre de la carta").fill("Carta");
  await page.getByLabel("Identificador de la carta (URL)").fill("carta");
  await page.getByRole("button", { name: "Crear carta" }).click();
  await page.waitForURL(/\/menus\/[0-9a-f-]+/);
  const menu = page.url().split("?")[0]!;
  for (const section of ["Entrantes", "Postres"]) {
    await page.getByPlaceholder("Nueva categoría").fill(section);
    await page.getByRole("button", { name: "Añadir categoría" }).click();
    await expect(page.getByRole("heading", { name: section, level: 4 })).toBeVisible();
  }
  for (const [section, dish] of [
    ["Entrantes", "Croquetas"],
    ["Postres", "Pulpo"],
  ] as const) {
    await page.getByLabel(`Producto para ${section}`).selectOption({ label: `${dish} (9,00 €)` });
    await page.getByRole("button", { name: `Añadir a ${section}` }).click();
    await expect(page.getByRole("button", { name: `Quitar ${dish}` })).toBeVisible();
  }
  await page.goto(`${menu}?tab=publicacion`);
  await page.getByRole("button", { name: "Publicar borrador" }).click();
  await expect(page.getByText(/Publicada la versión 1/)).toBeVisible();

  await page.goto(`${org}/ingredients`);
  await page.getByText("Nuevo ingrediente").click();
  await page.getByLabel("Nombre del ingrediente").fill("Harina");
  await page.getByRole("button", { name: "Crear ingrediente" }).click();
  await expect(page.getByRole("button", { name: "Archivar Harina" })).toBeVisible();
  await page.goto(`${est}/inventory?tab=almacenes`);
  await page.getByText("Nuevo almacén").click();
  await page.getByLabel("Nombre del almacén").fill("Cámara");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /^Cámara$/ })).toBeVisible();
  await page.goto(`${est}/inventory`);
  const movement = page.locator("section", { has: page.getByRole("heading", { name: "Registrar movimiento" }) });
  await movement.getByLabel("Cantidad").fill("5");
  await movement.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(movement.getByText("Movimiento registrado")).toBeVisible();

  await page.goto(`${org}/suppliers`);
  await page.getByText("Nuevo proveedor").click();
  await page.getByLabel("Nombre del proveedor").fill("Molinos");
  await page.getByRole("button", { name: "Crear proveedor" }).click();
  await expect(page.getByRole("button", { name: "Archivar Molinos" })).toBeVisible();
  await page.goto(`${est}/purchasing`);
  await page.getByText("Nuevo pedido").click();
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page.getByRole("heading", { name: /Pedido 1/ })).toBeVisible();
  const order = page.url();
  await page.getByLabel("Cantidad").fill("10");
  await page.getByLabel("Precio (€ por kg, l o ud.)").fill("1");
  await page.getByRole("button", { name: "Añadir o actualizar línea" }).click();
  await expect(page.getByText(/Total:/)).toBeVisible();

  await page.goto(`${est}/floor`);
  await page.getByLabel("Nombre de la zona").fill("Comedor");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await page.getByText("Nueva mesa en Comedor").click();
  await page.getByLabel("Nombre de la mesa").fill("M1");
  await page.getByLabel("Máximo").fill("4");
  await page.getByRole("button", { name: "Crear mesa" }).click();
  await expect(page.getByRole("button", { name: /^Mesa M1,/ })).toBeVisible();
  await page.goto(`${est}/reservations?date=2030-06-17`);
  const search = page.locator("section", { has: page.getByRole("heading", { name: "Nueva reserva" }) });
  await search.getByLabel("Hora").fill("21:00");
  await search.getByRole("button", { name: "Buscar mesas libres" }).click();
  await search.getByLabel(/^M1 /).check();
  await search.getByLabel("Nombre del cliente").fill("Marta");
  await search.getByRole("button", { name: "Crear reserva" }).click();
  await expect(page.getByText("Reserva creada")).toBeVisible();

  await page.goto(`${org}/members`);
  const email = `miembro-${suffix()}@example.test`;
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const link = await page.getByLabel("Enlace de invitación").inputValue();
  const other = await (await browser.newContext()).newPage();
  await other.goto(link);
  await other.getByLabel("Nombre").fill("Ana");
  await other.getByLabel(/Contraseña/).fill(PASSWORD);
  await other.getByRole("button", { name: "Crear cuenta y unirme" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "Casa Espacios" })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill(`otra-${suffix()}@example.test`);
  await page.getByRole("button", { name: "Crear invitación" }).click();

  await page.goto(`${est}/site?tab=contenido`);
  await page.getByLabel("Titular (obligatorio para publicar)").fill("Bienvenidos");
  await page.getByRole("button", { name: "Guardar página" }).click();
  await expect(page.getByText("Página guardada")).toBeVisible();
  await page.goto(`${est}/site?tab=marca`);
  await page.locator('input[name="image"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: await sharp({ create: { width: 300, height: 100, channels: 3, background: "#224466" } })
      .png()
      .toBuffer(),
  });
  await page.getByRole("button", { name: "Subir logotipo" }).click();
  await expect(page.getByRole("img", { name: "Logotipo de Puerto" })).toBeVisible();
  await page.getByRole("switch", { name: "Publicar la web" }).click();
  await expect(page.getByRole("switch", { name: "Publicar la web" })).toHaveAttribute("aria-checked", "true");

  const pages = [
    org,
    `${org}/products`,
    `${org}/ingredients`,
    `${org}/suppliers`,
    `${org}/members`,
    `${org}/privacy`,
    est,
    `${est}?tab=horario`,
    `${est}?tab=datos`,
    `${est}/menus`,
    menu,
    `${menu}?tab=publicacion`,
    `${menu}?tab=ajustes`,
    `${est}/inventory`,
    `${est}/inventory?tab=movimientos`,
    `${est}/inventory?tab=recuentos`,
    `${est}/inventory?tab=almacenes`,
    `${est}/purchasing`,
    order,
    `${est}/floor`,
    `${est}/reservations?date=2030-06-17`,
    `${est}/site`,
    `${est}/site?tab=marca`,
    `${est}/site?tab=contenido`,
    `${est}/site?tab=foto`,
    `${est}/stats`,
    `/${orgSlug}/puerto`,
  ];
  const problems: string[] = [];
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const url of pages) {
      await page.goto(url);
      const where = `${viewport.width}px ${new URL(page.url()).pathname}${new URL(page.url()).search}`;
      for (const p of await touchingButtons(page)) problems.push(`${where}: ${p}`);
    }
  }
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const topbars = new Map<number, string[]>();
    for (const url of pages) {
      await page.goto(url);
      const where = `${width}px ${new URL(page.url()).pathname}${new URL(page.url()).search}`;
      for (const p of await overflowIssues(page)) problems.push(`${where}: ${p}`);
      // La barra superior mide lo mismo en todas las páginas, cortas o largas.
      const bar = await page.evaluate(() => document.querySelector(".panel-topbar")?.getBoundingClientRect() ?? null);
      if (bar) topbars.set(Math.round(bar.height), [...(topbars.get(Math.round(bar.height)) ?? []), where]);
    }
    if (topbars.size > 1)
      problems.push(`${width}px: la barra superior cambia de alto: ${JSON.stringify([...topbars])}`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
