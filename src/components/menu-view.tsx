import { ALLERGEN_LABELS } from "@/lib/allergens";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { formatEuros } from "@/lib/money";
import { publicMediaUrl } from "@/lib/site";
import styles from "./menu-view.module.css";

interface Props {
  snapshot: MenuSnapshot;
  footer?: React.ReactNode;
}

/** Representación de una carta a partir de una instantánea (publicada o vista previa del borrador). */
export function MenuView({ snapshot, footer }: Props) {
  return (
    <div className={`${styles.page} ${styles[snapshot.theme]}`}>
      <article className={styles.menu}>
        <header className={styles.header}>
          <p className={styles.establishment}>{snapshot.establishmentName}</p>
          <h1 className={styles.title}>{snapshot.menuName}</h1>
        </header>
        {snapshot.sections.map((section, si) => (
          <section key={si} className={styles.section}>
            <h2 className={styles.sectionTitle}>{section.name}</h2>
            <ul className={styles.items}>
              {section.items.map((item, ii) => (
                <li key={ii} className={`${styles.item} ${item.imageId ? styles.withImage : ""}`}>
                  {item.imageId && (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen ya reducida y servida por la app
                    <img className={styles.image} src={publicMediaUrl(item.imageId)} alt={item.name} loading="lazy" />
                  )}
                  <div>
                    <div className={styles.itemLine}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.dots} aria-hidden="true" />
                      <span className={styles.price}>{formatEuros(item.priceCents)}</span>
                    </div>
                    {item.recommended && <p className={styles.recommended}>Recomendado</p>}
                    {item.description && <p className={styles.description}>{item.description}</p>}
                    {item.allergens.length > 0 && (
                      <p className={styles.allergens}>
                        <span className={styles.visuallyHidden}>Alérgenos: </span>
                        {item.allergens.map((a) => (
                          <span key={a} className={styles.allergen}>
                            {ALLERGEN_LABELS[a]}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <footer className={styles.footer}>
          <p>Precios en euros. Consulta al personal cualquier duda sobre alérgenos.</p>
          {footer}
        </footer>
      </article>
    </div>
  );
}
