import Link from "next/link";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import type { SiteHighlight } from "@/lib/site";
import { Icon } from "./icons";
import { MenuShowcase } from "./menu-showcase";
import { SiteShell, type SiteChrome } from "./site-shell";
import { StoriesBar, type StoryView } from "./stories";
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
  gallery = [],
  stories = [],
  storiesKey = "",
  banner,
}: {
  chrome: SiteChrome;
  site: SiteHomeContent;
  heroImageUrl: string | null;
  menuSections: MenuSnapshot["sections"] | null;
  /** Galería (D-039): URL de cada foto (pública o privada en la vista previa) y su pie. */
  gallery?: { url: string; caption: string | null }[];
  /** Historias vigentes (D-059) y clave para recordar en el navegador cuáles se vieron. */
  stories?: StoryView[];
  storiesKey?: string;
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
            {stories.length > 0 && (
              <StoriesBar
                stories={stories}
                storageKey={storiesKey}
                // Solo los textos del visor viajan al navegador.
                texts={{
                  stories: t.stories,
                  storyOpen: t.storyOpen,
                  storyClose: t.storyClose,
                  storyPrev: t.storyPrev,
                  storyNext: t.storyNext,
                  storyPause: t.storyPause,
                  storyPlay: t.storyPlay,
                  storyCount: t.storyCount,
                }}
              />
            )}
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

        {gallery.length > 0 && (
          <section id="galeria" className={styles.galleryBlock} aria-labelledby="galeria-titulo">
            <div className={styles.blockHead}>
              <h2 id="galeria-titulo" className={styles.blockTitle}>
                {t.gallery}
              </h2>
            </div>
            <ul className={styles.gallery}>
              {gallery.map((g, n) => (
                <li key={g.url}>
                  <figure>
                    <a href={g.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagen ya reducida y servida por la app */}
                      <img src={g.url} alt={g.caption ?? `${t.gallery} ${n + 1}`} loading="lazy" />
                    </a>
                    {g.caption && <figcaption>{g.caption}</figcaption>}
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Contacto (D-049): llamada a la acción hacia la página de contacto. */}
        <section className={styles.contactCta} aria-labelledby="contacto-cta">
          <h2 id="contacto-cta" className={styles.blockTitle}>
            {t.contactCtaTitle}
          </h2>
          <p>{t.contactCtaText}</p>
          <div className={styles.heroActions}>
            <Link href={chrome.links.contact} className={styles.buttonPrimary}>
              {t.contactCta} <Icon name="arrow" className={styles.buttonIcon} />
            </Link>
            {chrome.phone && (
              <a href={`tel:${chrome.phone.replace(/[^0-9+]/g, "")}`} className={styles.buttonGhost}>
                {chrome.phone}
              </a>
            )}
          </div>
        </section>
      </SiteShell>
    </>
  );
}
