import type { MenuSnapshot } from "@/lib/menu-snapshot";
import type { PublicLanguage } from "@/lib/languages";
import { formatEuros } from "@/lib/money";
import { PriceFormatList } from "@/components/price-formats";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import type { MenuServing } from "@/server/modules/menus/availability";
import { publicMediaUrl } from "@/lib/site";
import { MenuServingInfo } from "@/components/menu-serving";
import styles from "./menu-view.module.css";

interface Props {
  snapshot: MenuSnapshot;
  footer?: React.ReactNode;
  lang?: PublicLanguage;
  /** Selector de idioma (si la carta se ofrece en varios). */
  languageLinks?: { lang: PublicLanguage; label: string; href: string }[];
  /** Horario de la carta y las demás cartas del local (D-036). */
  serving?: MenuServing | null;
}

/** Representación de una carta a partir de una instantánea (publicada o vista previa del borrador). */
export function MenuView({ snapshot, footer, lang = "es", languageLinks = [], serving = null }: Props) {
  const t = PUBLIC_TEXTS[lang];
  return (
    <div lang={lang} className={`${styles.page} ${styles[snapshot.theme]}`}>
      <article className={styles.menu}>
        {languageLinks.length > 1 && (
          <nav className={styles.languages} aria-label={t.language}>
            {languageLinks.map((l) => (
              <a key={l.lang} href={l.href} hrefLang={l.lang} lang={l.lang} aria-current={l.lang === lang ? "true" : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
        )}
        <header className={styles.header}>
          <p className={styles.establishment}>{snapshot.establishmentName}</p>
          <h1 className={styles.title}>{snapshot.menuName}</h1>
        </header>
        {serving && <MenuServingInfo serving={serving} lang={lang} />}
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
                      {!item.formats && (
                        <>
                          <span className={styles.dots} aria-hidden="true" />
                          <span className={styles.price}>{formatEuros(item.priceCents)}</span>
                        </>
                      )}
                    </div>
                    {item.formats && <PriceFormatList formats={item.formats} lang={lang} priceClassName={styles.price} />}
                    {item.recommended && <p className={styles.recommended}>{t.recommended}</p>}
                    {item.description && <p className={styles.description}>{item.description}</p>}
                    {item.allergens.length > 0 && (
                      <p className={styles.allergens}>
                        <span className={styles.visuallyHidden}>{t.allergens}: </span>
                        {item.allergens.map((a) => (
                          <span key={a} className={styles.allergen}>
                            {t.allergenNames[a]}
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
          <p>{t.menuNote}</p>
          {footer}
        </footer>
      </article>
    </div>
  );
}
