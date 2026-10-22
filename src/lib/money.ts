/** Importe en euros escrito por una persona ("12,50", "12.5", "12") → céntimos. */
export function parseEuroAmount(value: string): number | null {
  const v = value.trim().replace(/\s|€/g, "");
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function formatEuros(cents: number): string {
  return euro.format(cents / 100);
}

/** Céntimos → texto editable ("12,50"). */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Coste unitario en euros con hasta 4 decimales ("0,1875", "12,5") → céntimos
 * como literal numeric con hasta 2 decimales ("18.75", "1250.00").
 */
export function parseEuroCost(value: string): string | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,4}))?$/.exec(value.trim().replace(/\s|€/g, ""));
  if (!m) return null;
  const tenThousandths = BigInt(m[1]!) * 10000n + BigInt((m[2] ?? "").padEnd(4, "0") || "0");
  return `${tenThousandths / 100n}.${String(tenThousandths % 100n).padStart(2, "0")}`;
}

/** Céntimos (literal numeric, puede tener decimales) → "12,35 €" redondeado al céntimo. */
export function formatCentsNumeric(value: string): string {
  return formatEuros(Math.round(Number(value)));
}

/** Céntimos (numeric) → texto editable en euros con hasta 4 decimales ("0,1875"). */
export function centsNumericToInput(value: string): string {
  const euros = Number(value) / 100;
  return euros.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 4 });
}
