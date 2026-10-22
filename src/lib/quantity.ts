/**
 * Cantidades de inventario con aritmética entera (milésimas como BigInt) para
 * evitar errores de coma flotante. En BD se guardan como numeric(14,3) en la
 * unidad base del ingrediente.
 */

export const BASE_UNITS = ["g", "ml", "unit"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export const INPUT_UNITS = {
  g: { base: "g", factor: 1n, label: "g" },
  kg: { base: "g", factor: 1000n, label: "kg" },
  ml: { base: "ml", factor: 1n, label: "ml" },
  cl: { base: "ml", factor: 10n, label: "cl" },
  l: { base: "ml", factor: 1000n, label: "l" },
  unit: { base: "unit", factor: 1n, label: "ud." },
} as const satisfies Record<string, { base: BaseUnit; factor: bigint; label: string }>;
export type InputUnit = keyof typeof INPUT_UNITS;

export const BASE_UNIT_LABELS: Record<BaseUnit, string> = { g: "gramos", ml: "mililitros", unit: "unidades" };

/** Máximo representable en numeric(14,3): 11 dígitos enteros. */
const MAX_THOUSANDTHS = 10n ** 14n - 1n;

export function unitsFor(base: BaseUnit): InputUnit[] {
  return (Object.keys(INPUT_UNITS) as InputUnit[]).filter((u) => INPUT_UNITS[u].base === base);
}

/** "1,5" / "1.5" / "2" → milésimas (1500n). Solo positivos, hasta 3 decimales. */
export function parseQuantity(input: string): bigint | null {
  const m = /^(\d{1,11})(?:[.,](\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  const value = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0") || "0");
  return value > 0n && value <= MAX_THOUSANDTHS ? value : null;
}

/** Convierte milésimas en una unidad de entrada a milésimas de la unidad base. */
export function toBase(thousandths: bigint, unit: InputUnit, base: BaseUnit): bigint | null {
  const u = INPUT_UNITS[unit];
  if (u.base !== base) return null;
  const v = thousandths * u.factor;
  return v <= MAX_THOUSANDTHS ? v : null;
}

/** Milésimas (con signo) → literal numeric para PostgreSQL ("-1500.000"). */
export function toNumericString(thousandths: bigint): string {
  const neg = thousandths < 0n;
  const abs = neg ? -thousandths : thousandths;
  return `${neg ? "-" : ""}${abs / 1000n}.${String(abs % 1000n).padStart(3, "0")}`;
}

/** Literal numeric de PostgreSQL → milésimas. */
export function fromNumericString(value: string): bigint {
  const m = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) throw new Error(`Cantidad no válida: ${value}`);
  const v = BigInt(m[2]!) * 1000n + BigInt((m[3] ?? "").padEnd(3, "0") || "0");
  return m[1] ? -v : v;
}

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 });

/** Presentación legible: 1500 g → "1,5 kg"; 250 ml → "250 ml"; 3 unidades → "3 ud.". */
export function formatQuantity(value: string, base: BaseUnit): string {
  const t = fromNumericString(value);
  const abs = t < 0n ? -t : t;
  if (base !== "unit" && abs >= 1_000_000n) {
    return `${nf.format(Number(t) / 1_000_000)} ${base === "g" ? "kg" : "l"}`;
  }
  return `${nf.format(Number(t) / 1000)} ${INPUT_UNITS[base].label}`;
}
