import { ALLERGEN_LABELS } from "@/lib/allergens";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { formatEuros } from "@/lib/money";
import { PriceFormatList } from "@/components/price-formats";
import styles from "./menu-print.module.css";

export interface PrintOptions {
  descriptions: boolean;
  allergens: boolean;
  columns: 1 | 2;
}

/** Carta en formato de papel a partir de una instantánea (publicada o borrador). */
export function MenuPrint({
  snapshot,
  options,
  qrDataUrl,
}: {
  snapshot: MenuSnapshot;
  options: PrintOptions;
  /** QR del enlace permanente (solo si la carta está publicada). */
  qrDataUrl: string | null;
}) {
  const sections = snapshot.sections.filter((s) => s.items.length > 0);
  return (
    <article className={styles.page} aria-label="Carta para imprimir">
      <header className={styles.header}>
        <p className={styles.establishment}>{snapshot.establishmentName}</p>
        <h1 className={styles.menuName}>{snapshot.menuName}</h1>
        <hr className={styles.rule} />
      </header>
      <div className={options.columns === 2 ? `${styles.sections} ${styles.twoColumns}` : styles.sections}>
        {sections.map((section, i) => (
          <section key={i} className={styles.section}>
            <h2>{section.name}</h2>
            <ul className={styles.items}>
              {section.items.map((item, j) => (
                <li key={j} className={styles.item}>
                  <div className={styles.line}>
                    <span className={styles.name}>{item.name}</span>
                    {!item.formats && (
                      <>
                        <span className={styles.leader} aria-hidden="true" />
                        <span className={styles.price}>{formatEuros(item.priceCents)}</span>
                      </>
                    )}
                  </div>
                  {item.formats && <PriceFormatList formats={item.formats} lang="es" priceClassName={styles.price} />}
                  {options.descriptions && item.description && <p className={styles.description}>{item.description}</p>}
                  {options.allergens && item.allergens.length > 0 && (
                    <p className={styles.allergens}>
                      Alérgenos: {item.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <footer className={styles.footer}>
        <p>
          {options.allergens
            ? "Si tienes alguna alergia o intolerancia, consulta con nuestro personal."
            : "Información sobre alérgenos disponible: consulta con nuestro personal."}
        </p>
        {qrDataUrl && (
          <div className={styles.qr}>
            <span>
              Carta online
              <br />
              escanea el código
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG generado en el servidor como data: */}
            <img src={qrDataUrl} alt="Código QR de la carta online" />
          </div>
        )}
      </footer>
    </article>
  );
}
