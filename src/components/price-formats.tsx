import type { PublicLanguage } from "@/lib/languages";
import { formatEuros } from "@/lib/money";
import { formatLabel, type PriceFormat } from "@/lib/price-formats";
import styles from "./price-formats.module.css";

/**
 * Formatos de un plato (D-038), uno por línea: «Media ración … 6,00 €». El
 * precio usa la clase del diseño que lo pinta para heredar su estilo.
 */
export function PriceFormatList({
  formats,
  lang,
  priceClassName,
}: {
  formats: PriceFormat[];
  lang: PublicLanguage;
  priceClassName?: string;
}) {
  return (
    <ul className={styles.formats}>
      {formats.map((f) => (
        <li key={f.label}>
          <span>{formatLabel(f.label, lang)}</span>
          <span className={`${styles.price} ${priceClassName ?? ""}`}>{formatEuros(f.priceCents)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Formatos en una línea, para tarjetas: «Media ración 6,00 € · Ración 10,00 €». */
export function priceFormatsText(formats: PriceFormat[], lang: PublicLanguage): string {
  return formats.map((f) => `${formatLabel(f.label, lang)} ${formatEuros(f.priceCents)}`).join(" · ");
}
