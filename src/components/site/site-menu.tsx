import { ALLERGEN_LABELS } from "@/lib/allergens";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { formatEuros } from "@/lib/money";
import { publicMediaUrl } from "@/lib/site";
import styles from "./site.module.css";

/** Carta completa con el diseño de la web del local (solo lee la instantánea publicada). */
export function SiteMenu({ snapshot }: { snapshot: MenuSnapshot }) {
  return (
    <>
      <section className={styles.pageHead}>
        <p className={styles.eyebrow}>Nuestra carta</p>
        <h1 className={styles.heroTitle}>{snapshot.menuName}</h1>
        <span className={styles.rule} aria-hidden="true" />
      </section>
      {snapshot.sections.length > 1 && (
        <nav className={styles.sectionNav} aria-label="Categorías">
          {snapshot.sections.map((s, i) => (
            <a key={i} href={`#categoria-${i + 1}`}>
              {s.name}
            </a>
          ))}
        </nav>
      )}
      <div className={styles.menuList}>
        {snapshot.sections.map((section, si) => (
          <section key={si} id={`categoria-${si + 1}`} className={styles.menuSection}>
            <h2 className={styles.blockTitle}>{section.name}</h2>
            <ul className={styles.dishes}>
              {section.items.map((item, ii) => (
                <li key={ii} className={`${styles.dish} ${item.imageId ? styles.dishWithImage : ""}`}>
                  {item.imageId && (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen ya reducida y servida por la app
                    <img className={styles.dishImage} src={publicMediaUrl(item.imageId)} alt={item.name} loading="lazy" />
                  )}
                  <div>
                    <div className={styles.dishHead}>
                      <h3 className={styles.dishName}>{item.name}</h3>
                      <span className={styles.dishPrice}>{formatEuros(item.priceCents)}</span>
                    </div>
                    {item.recommended && <p className={styles.cardBadge}>Recomendado</p>}
                    {item.description && <p className={styles.cardText}>{item.description}</p>}
                    {item.allergens.length > 0 && (
                      <ul className={styles.chips} aria-label="Alérgenos">
                        {item.allergens.map((a) => (
                          <li key={a}>{ALLERGEN_LABELS[a]}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className={styles.menuNote}>Precios en euros. Consulta al personal cualquier duda sobre alérgenos.</p>
      </div>
    </>
  );
}
