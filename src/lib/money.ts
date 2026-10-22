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
