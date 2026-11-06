#!/usr/bin/env node
/**
 * Descarga una vez las fuentes de Google que usa la aplicación (subconjunto
 * latino, como hacía next/font/google) a src/fonts/ y genera
 * src/fonts/index.ts con las llamadas a next/font/local (D-043). La
 * compilación ya no depende de Google Fonts: este script solo se ejecuta a mano
 * para añadir o actualizar fuentes, y su resultado se guarda en el repositorio.
 *
 *   node scripts/fetch-fonts.mjs
 *
 * Las fuentes son de Google Fonts con licencia SIL Open Font License 1.1 o
 * Apache 2.0, que permiten redistribuirlas incluidas en la aplicación.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "src/fonts");
const fontData = JSON.parse(
  readFileSync(require.resolve("next/dist/compiled/@next/font/dist/google/font-data.json", { paths: [root] }), "utf8"),
);

/** [clave, familia, pesos (null = variable), variable CSS]. Mismos pesos que antes. */
const FONTS = [
  // Panel
  ["panelsans", "Inter", null, "--font-panel-sans"],
  ["panelserif", "Fraunces", ["500", "600"], "--font-panel-serif"],
  // Web pública (D-034)
  ["inter", "Inter", null, "--font-inter"],
  ["orbitron", "Orbitron", null, "--font-orbitron"],
  ["caveat", "Caveat", null, "--font-caveat"],
  ["oswald", "Oswald", null, "--font-oswald"],
  ["courier", "Courier Prime", ["400", "700"], "--font-courier"],
  ["baskerville", "Libre Baskerville", ["400", "700"], "--font-baskerville"],
  ["cormorant", "Cormorant Garamond", ["400", "500", "600"], "--font-cormorant"],
  ["montserrat", "Montserrat", null, "--font-montserrat"],
  ["playfair", "Playfair Display", null, "--font-playfair"],
  ["lato", "Lato", ["400", "700"], "--font-lato"],
  ["cinzel", "Cinzel", null, "--font-cinzel"],
  ["raleway", "Raleway", null, "--font-raleway"],
  ["ebgaramond", "EB Garamond", null, "--font-ebgaramond"],
  ["worksans", "Work Sans", null, "--font-worksans"],
  ["dancing", "Dancing Script", null, "--font-dancing"],
  ["bebas", "Bebas Neue", ["400"], "--font-bebas"],
  ["lora", "Lora", null, "--font-lora"],
  ["kalam", "Kalam", ["400", "700"], "--font-kalam"],
  ["archivonarrow", "Archivo Narrow", null, "--font-archivonarrow"],
  ["crimson", "Crimson Text", ["400", "600", "700"], "--font-crimson"],
  ["satisfy", "Satisfy", ["400"], "--font-satisfy"],
  ["robotocondensed", "Roboto Condensed", null, "--font-robotocondensed"],
  ["merriweather", "Merriweather", ["400", "700"], "--font-merriweather"],
  ["audiowide", "Audiowide", ["400"], "--font-audiowide"],
  ["exo2", "Exo 2", null, "--font-exo2"],
  ["michroma", "Michroma", ["400"], "--font-michroma"],
  ["spacegrotesk", "Space Grotesk", null, "--font-spacegrotesk"],
  ["syncopate", "Syncopate", ["400", "700"], "--font-syncopate"],
  ["manrope", "Manrope", null, "--font-manrope"],
  ["poppins", "Poppins", ["400", "500", "600", "700"], "--font-poppins"],
  ["plexsans", "IBM Plex Sans", ["400", "500", "600"], "--font-plexsans"],
  ["dmserif", "DM Serif Display", ["400"], "--font-dmserif"],
  ["dmsans", "DM Sans", null, "--font-dmsans"],
  // Web pública de Nébora (D-065): Archivo con anchura variable y Courier Prime para los tickets.
  ["marketing", "Archivo", "wdth,wght@62..125,100..900", "--font-marketing"],
  ["marketingmono", "Courier Prime", ["400", "700"], "--font-marketing-mono"],
];

// Un navegador moderno: Google responde con woff2.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// curl respeta el proxy del entorno (fetch de Node no).
const get = (url) => execFileSync("curl", ["-sSfL", "-A", UA, url], { maxBuffer: 50 * 1024 * 1024 });

function cssUrl(family, weights) {
  const name = family.replaceAll(" ", "+");
  // Ejes explícitos (p. ej. anchura y peso): "wdth,wght@62..125,100..900".
  if (typeof weights === "string") return `https://fonts.googleapis.com/css2?family=${name}:${weights}&display=swap`;
  if (weights) return `https://fonts.googleapis.com/css2?family=${name}:wght@${weights.join(";")}&display=swap`;
  const wght = fontData[family]?.axes?.find((a) => a.tag === "wght");
  if (!wght) throw new Error(`${family}: sin eje de peso; indica pesos fijos`);
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${wght.min}..${wght.max}&display=swap`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "licenses"), { recursive: true });
const calls = [];
/**
 * Fuentes del panel con `display: "optional"` (D-057): con `swap`, el cambio de
 * la fuente de reserva a la definitiva recolocaba el texto (por ejemplo, las
 * pestañas pasaban de dos líneas a una) y desplazaba la página. Con
 * `optional` se usa la definitiva si llega a tiempo para la primera pintura;
 * si no, esa carga se queda con la de reserva y la siguiente la toma de la caché.
 */
const OPTIONAL_DISPLAY = new Set(["panelsans", "panelserif", "marketing", "marketingmono"]);

for (const [key, family, weights, cssVar] of FONTS) {
  // La misma familia con los mismos pesos comparte archivos (p. ej. Inter del panel y de la web).
  const same = calls.find((c) => c.family === family && c.weights === String(weights));
  if (same) {
    calls.push({ key, family, weights: String(weights), cssVar, src: same.src });
    continue;
  }
  const css = get(cssUrl(family, weights)).toString("utf8");
  // Solo los bloques /* latin */ (no latin-ext, cirílico…), como subsets: ["latin"].
  const blocks = [...css.matchAll(/\/\* latin \*\/\s*@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error(`${family}: sin bloque latino`);
  const src = blocks.map((b) => {
    const url = /src:\s*url\(([^)]+)\)/.exec(b)[1];
    const weight = /font-weight:\s*([^;]+);/.exec(b)[1].trim();
    // Solo las de anchura variable (un rango) llevan la anchura en el nombre.
    const stretch = /font-stretch:\s*([^;]+ [^;]+);/.exec(b)?.[1].trim();
    const file = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${weight.replace(" ", "-")}${stretch ? `-w${stretch.replace(/[% ]+/g, "-").replace(/-$/, "")}` : ""}.woff2`;
    writeFileSync(path.join(outDir, file), get(url));
    return { path: `./${file}`, weight, style: "normal", stretch };
  });
  // Anchura variable: el @font-face debe declarar su rango para que font-stretch funcione.
  const stretchRange = src.find((s) => s.stretch)?.stretch;
  for (const s of src) delete s.stretch;
  calls.push({ key, family, weights: String(weights), cssVar, src, stretchRange });
  console.log(`${family}: ${src.map((s) => s.weight).join(", ")}`);
}

// Licencias: cada familia con el texto de su licencia (OFL o Apache), que
// debe acompañar a las fuentes al redistribuirlas.
const licenses = [];
for (const family of [...new Set(FONTS.map((f) => f[1]))]) {
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  let found = null;
  for (const [kind, file] of [
    ["ofl", "OFL.txt"],
    ["apache", "LICENSE.txt"],
    ["ufl", "UFL.txt"],
  ]) {
    try {
      found = { kind, text: get(`https://raw.githubusercontent.com/google/fonts/main/${kind}/${dir}/${file}`) };
      break;
    } catch {
      // Probar el siguiente tipo de licencia.
    }
  }
  if (!found) throw new Error(`${family}: licencia no encontrada`);
  const name = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${found.kind}.txt`;
  writeFileSync(path.join(outDir, "licenses", name), found.text);
  licenses.push(`- ${family}: ${found.kind === "ofl" ? "SIL Open Font License 1.1" : found.kind === "apache" ? "Apache License 2.0" : "Ubuntu Font Licence 1.0"} (licenses/${name})`);
}
writeFileSync(
  path.join(outDir, "LICENSES.md"),
  `# Licencias de las fuentes\n\nFuentes de Google Fonts incluidas en la aplicación (subconjunto latino), generadas con\n\`scripts/fetch-fonts.mjs\`. Cada una se distribuye con su licencia:\n\n${licenses.join("\n")}\n`,
);

// Fuentes de la web pública de Nébora (D-065): en un módulo aparte y con
// precarga, para que lleguen a la primera pintura de la portada sin que el
// panel, que importa src/fonts/index.ts, las descargue.
const isMarketing = (c) => c.key.startsWith("marketing");
const render = (c, preload) => `/** ${c.family} */
export const ${c.key} = localFont({
  src: ${JSON.stringify(c.src, null, 2).replaceAll('"path"', "path").replaceAll('"weight"', "weight").replaceAll('"style"', "style")},
  display: "${OPTIONAL_DISPLAY.has(c.key) ? "optional" : "swap"}",${c.stretchRange ? `\n  declarations: [{ prop: "font-stretch", value: "${c.stretchRange}" }],` : ""}
  preload: ${preload},
  variable: "${c.cssVar}",
});`;
const header = (note) => `// Generado por scripts/fetch-fonts.mjs: no editar a mano (D-043).
// ${note}
import localFont from "next/font/local";
`;
const ts = `${header("Fuentes alojadas en el repositorio: la compilación no descarga nada. Sin\n// precarga: el navegador solo baja las que usa la página.")}
${calls
  .filter((c) => !isMarketing(c))
  .map((c) => render(c, false))
  .join("\n\n")}
`;
const marketingTs = `${header("Web pública de Nébora (D-065): con precarga, solo en sus páginas.")}
${calls
  .filter(isMarketing)
  .map((c) => render(c, true))
  .join("\n\n")}
`;
writeFileSync(path.join(outDir, "index.ts"), ts);
writeFileSync(path.join(outDir, "marketing.ts"), marketingTs);
execFileSync("npx", ["prettier", "--print-width", "120", "--write", path.join(outDir, "marketing.ts")], { stdio: "ignore" });
execFileSync("npx", ["prettier", "--print-width", "120", "--write", path.join(outDir, "index.ts")], { stdio: "ignore" });
console.log(`Escrito ${path.relative(root, path.join(outDir, "index.ts"))}`);
