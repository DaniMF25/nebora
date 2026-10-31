import Link from "next/link";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import type { SiteHighlight } from "@/lib/site";
import { Icon } from "./icons";
import { MenuShowcase } from "./menu-showcase";
import { SiteShell, type SiteChrome } from "./site-shell";
import styles from "./site.module.css";

export interface SiteHomeContent {
  heroEyebrow: string | null;
  heroTitle: string | null;
  heroText: string | null;
  highlights: SiteHighlight[];
}

/**
 * Portada de la web del local. La usan la página pública y la vista previa
 * del panel (que pasa la foto por la ruta privada y otro tema).
 */
export function SiteHome({
  chrome,
  site,
  heroImageUrl,
  menuSections,
  banner,
}: {
  chrome: SiteChrome;
  site: SiteHomeContent;
  heroImageUrl: string | null;
  menuSections: MenuSnapshot["sections"] | null;
  banner?: React.ReactNode;
}) {
  const menuHref = menuSections ? chrome.links.menu : null;
  const t = PUBLIC_TEXTS[chrome.lang ?? "es"];
  const bookingHref = chrome.links.booking;
  return (
    <>
      {banner}
      <SiteShell current="home" site={chrome}>
        <section
          className={`${styles.hero} ${heroImageUrl ? styles.heroWithImage : ""}`}
          style={heroImageUrl ? { ["--hero-image" as string]: `url(${heroImageUrl})` } : undefined}
        >
          <div className={styles.heroInner}>
            {site.heroEyebrow && <p className={styles.eyebrow}>{site.heroEyebrow}</p>}
            <h1 className={styles.heroTitle}>{site.heroTitle}</h1>
            <span className={styles.rule} aria-hidden="true" />
            {site.heroText && <p className={styles.heroText}>{site.heroText}</p>}
            <div className={styles.heroActions}>
              {bookingHref && (
                <Link href={bookingHref} className={styles.buttonPrimary}>
                  {t.bookTable}
                </Link>
              )}
              <a href="#contacto" className={styles.buttonGhost}>
                {t.seeHours} <Icon name="arrow" className={styles.buttonIcon} />
              </a>
            </div>
          </div>
        </section>

        {menuSections && menuHref && (
          <section className={styles.menuBlock} aria-labelledby="nuestra-carta">
            <div className={styles.blockHead}>
              <h2 id="nuestra-carta" className={styles.blockTitle}>
                {t.ourMenu}
              </h2>
              <Link href={menuHref} className={styles.textLink}>
                {t.seeFullMenu} <Icon name="arrow" className={styles.buttonIcon} />
              </Link>
            </div>
            <MenuShowcase sections={menuSections} fullMenuHref={menuHref} texts={t} lang={chrome.lang ?? "es"} />
          </section>
        )}

        {site.highlights.length > 0 && (
          <section className={styles.highlights} aria-label={t.whatDefinesUs}>
            <ul>
              {site.highlights.map((h) => (
                <li key={h.title}>
                  <Icon name={h.icon} className={styles.highlightIcon} />
                  <div>
                    <h2>{h.title}</h2>
                    {h.text && <p>{h.text}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SiteShell>
    </>
  );
}
