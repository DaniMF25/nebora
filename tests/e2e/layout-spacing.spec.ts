import { expect, test, type Page } from "@playwright/test";
import { seedShowcase } from "./showcase";

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

test("botones separados, sin desbordamientos en móvil ni violaciones de CSP en las páginas del panel", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // Ninguna página del recorrido puede provocar violaciones de la CSP (D-044).
  const cspViolations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text()))
      cspViolations.push(`${page.url()}: ${m.text()}`);
  });
  const { pages } = await seedShowcase(page, browser);
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
  expect(cspViolations, cspViolations.join("\n")).toEqual([]);
});
