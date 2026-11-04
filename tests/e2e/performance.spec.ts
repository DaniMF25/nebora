import { expect, test, type Page } from "@playwright/test";
import { seedShowcase } from "./showcase";

/**
 * Rendimiento de las páginas con datos reales sobre el build de producción.
 * Se comprueban límites deterministas (bytes de JavaScript y CSS que se
 * descargan, desplazamientos de diseño) y se anotan los tiempos medidos
 * (respuesta del servidor, LCP), que dependen de la máquina y no se exigen.
 */
const KB = 1024;
/**
 * Límites en bytes transferidos (comprimidos, como llegan al móvil). Medido el
 * 2026-11-04: ~140 KB de JavaScript en todas las páginas, casi todo React y
 * Next.js (el código propio es pequeño), y ~15 KB de CSS. El margen permite
 * crecer sin que un cambio duplique el peso sin darnos cuenta.
 */
const BUDGET = {
  publicJs: 180 * KB,
  panelJs: 200 * KB,
  css: 30 * KB,
  cls: 0.1,
};

interface Metrics {
  url: string;
  ttfb: number;
  lcp: number;
  cls: number;
  js: number;
  css: number;
  requests: number;
}

async function measure(page: Page, url: string): Promise<Metrics> {
  const sizes = { js: 0, css: 0, requests: 0 };
  const pending: Promise<void>[] = [];
  const onFinished = (req: import("@playwright/test").Request) => {
    pending.push(
      (async () => {
        const type = req.resourceType();
        // Bytes del cuerpo tal como viajan (comprimidos si el servidor comprime).
        const bytes = Math.max(0, (await req.sizes()).responseBodySize);
        sizes.requests++;
        if (type === "script") sizes.js += bytes;
        else if (type === "stylesheet") sizes.css += bytes;
      })().catch(() => {}),
    );
  };
  page.on("requestfinished", onFinished);
  // Como una primera visita: sin la caché HTTP del navegador.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await Promise.all(pending);
  const timing = await page.evaluate(
    () =>
      new Promise<{ ttfb: number; lcp: number; cls: number }>((resolve) => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
            if (!e.hadRecentInput) cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve({ ttfb: nav.responseStart - nav.requestStart, lcp, cls }), 300);
      }),
  );
  page.off("requestfinished", onFinished);
  await cdp.detach();
  return { url: new URL(page.url()).pathname, ...timing, ...sizes };
}

test("rendimiento: peso de JavaScript y CSS y estabilidad visual dentro de los límites", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const { org, est, menu, orgSlug } = await seedShowcase(page, browser);

  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const publicPages = [
    `/${orgSlug}/puerto`,
    `/${orgSlug}/puerto/contacto`,
    `/m/${orgSlug}/puerto/carta`,
    `/r/${orgSlug}/puerto`,
  ];
  const panelPages = [org, est, `${est}/menus`, menu, `${est}/reservations?date=2030-06-17`, `${est}/floor`];

  const rows: Metrics[] = [];
  const problems: string[] = [];
  for (const [p, urls, jsBudget] of [
    [visitor, publicPages, BUDGET.publicJs],
    [page, panelPages, BUDGET.panelJs],
  ] as const) {
    for (const url of urls) {
      const m = await measure(p, url);
      rows.push(m);
      if (m.js > jsBudget) problems.push(`${m.url}: ${Math.round(m.js / KB)} KB de JavaScript (límite ${jsBudget / KB})`);
      if (m.css > BUDGET.css) problems.push(`${m.url}: ${Math.round(m.css / KB)} KB de CSS (límite ${BUDGET.css / KB})`);
      if (m.cls > BUDGET.cls) problems.push(`${m.url}: CLS ${m.cls.toFixed(3)} (límite ${BUDGET.cls})`);
    }
  }
  const table = rows
    .map(
      (r) =>
        `${r.url.replace(/[0-9a-f-]{36}/g, "…").padEnd(48)} TTFB ${String(Math.round(r.ttfb)).padStart(4)} ms · LCP ${String(Math.round(r.lcp)).padStart(5)} ms · CLS ${r.cls.toFixed(3)} · JS ${String(Math.round(r.js / KB)).padStart(4)} KB · CSS ${String(Math.round(r.css / KB)).padStart(3)} KB · ${r.requests} peticiones`,
    )
    .join("\n");
  console.log(`\n${table}`);
  test.info().annotations.push({ type: "métricas", description: table });
  expect(problems, problems.join("\n")).toEqual([]);
});
