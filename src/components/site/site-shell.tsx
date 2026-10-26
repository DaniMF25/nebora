import Link from "next/link";
import type { PublicLanguage } from "@/lib/languages";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { groupOpeningHours, type WeeklySlot } from "@/lib/site-hours";
import { themeFontClasses } from "./fonts";
import { Icon } from "./icons";
import styles from "./site.module.css";

/** Datos públicos comunes a las páginas del local (inicio, carta y reservas). */
export interface SiteChrome {
  theme: MenuTheme;
  establishmentName: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  openingHours: WeeklySlot[];
  links: { home: string; menu: string | null; booking: string | null };
  /** Idioma de la página (por defecto español) y enlaces del selector de idioma. */
  lang?: PublicLanguage;
  languageLinks?: { lang: PublicLanguage; label: string; href: string }[];
}

type Current = "home" | "menu" | "booking";

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Estructura común de la web pública del local: cabecera, pie con contacto y
 * horario reales y navegación inferior en móvil. Solo enlaza a páginas que
 * existen (la carta si hay una publicada, reservas si están activadas).
 */
export function SiteShell({ site, current, children }: { site: SiteChrome; current: Current; children: React.ReactNode }) {
  const { links } = site;
  const lang = site.lang ?? "es";
  const t = PUBLIC_TEXTS[lang];
  const nav: { key: Current; href: string; label: string; icon: "home" | "menu" | "calendar" }[] = [
    { key: "home", href: links.home, label: t.home, icon: "home" },
    ...(links.menu ? [{ key: "menu" as const, href: links.menu, label: t.menu, icon: "menu" as const }] : []),
    ...(links.booking ? [{ key: "booking" as const, href: links.booking, label: t.book, icon: "calendar" as const }] : []),
  ];
  const hours = groupOpeningHours(site.openingHours, t);
  const languages = site.languageLinks ?? [];

  return (
    <div
      lang={lang}
      className={`${styles.site} ${styles[site.theme]} ${current === "home" ? styles.overlay : ""} ${themeFontClasses(site.theme)}`}
    >
      <header className={styles.header}>
        <details className={styles.menuToggle}>
          <summary aria-label={t.openMenu}>
            <span />
            <span />
            <span />
          </summary>
          <nav className={styles.drawer} aria-label={t.sections}>
            {nav.map((n) => (
              <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
            <a href={`${links.home}#contacto`}>{t.hoursAndContact}</a>
          </nav>
        </details>
        <Link href={links.home} className={styles.brand}>
          <span className={styles.brandName}>{site.establishmentName}</span>
          {site.tagline && <span className={styles.brandTagline}>{site.tagline}</span>}
        </Link>
        <div className={styles.headerAction}>
          {languages.length > 1 && (
            <details className={styles.langMenu}>
              <summary aria-label={`${t.language}: ${languages.find((l) => l.lang === lang)?.label ?? lang}`}>
                {lang.toUpperCase()}
              </summary>
              <ul>
                {languages.map((l) => (
                  <li key={l.lang}>
                    <a href={l.href} hrefLang={l.lang} lang={l.lang} aria-current={l.lang === lang ? "true" : undefined}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {links.booking && current !== "booking" && (
            <Link href={links.booking} className={styles.headerCta}>
              {t.book}
            </Link>
          )}
        </div>
      </header>

      {children}

      <footer className={styles.contact} id="contacto">
        <div className={styles.contactGrid}>
          {site.address && (
            <div className={styles.contactItem}>
              <Icon name="pin" className={styles.contactIcon} />
              <h2>{t.whereWeAre}</h2>
              <p>{site.address}</p>
              <a href={mapsUrl(site.address)} target="_blank" rel="noopener noreferrer">
                {t.directions}
              </a>
            </div>
          )}
          {site.phone && (
            <div className={styles.contactItem}>
              <Icon name="phone" className={styles.contactIcon} />
              <h2>{t.callUs}</h2>
              <p>
                <a href={`tel:${site.phone.replace(/[^0-9+]/g, "")}`}>{site.phone}</a>
              </p>
            </div>
          )}
          <div className={styles.contactItem}>
            <Icon name="clock" className={styles.contactIcon} />
            <h2>{t.hours}</h2>
            {hours.length === 0 ? (
              <p>{t.askAvailability}</p>
            ) : (
              <dl className={styles.hours}>
                {hours.map((h) => (
                  <div key={h.days}>
                    <dt>{h.days}</dt>
                    {h.slots.map((s) => (
                      <dd key={s}>{s}</dd>
                    ))}
                  </div>
                ))}
              </dl>
            )}
          </div>
          {site.instagram && (
            <div className={styles.contactItem}>
              <Icon name="instagram" className={styles.contactIcon} />
              <h2>{t.followUs}</h2>
              <p>
                <a href={`https://www.instagram.com/${site.instagram}/`} target="_blank" rel="noopener noreferrer">
                  @{site.instagram}
                </a>
              </p>
            </div>
          )}
          {site.whatsapp && (
            <div className={styles.contactItem}>
              <Icon name="whatsapp" className={styles.contactIcon} />
              <h2>WhatsApp</h2>
              <p>
                <a href={`https://wa.me/${site.whatsapp}`} target="_blank" rel="noopener noreferrer">
                  {t.writeUs}
                </a>
              </p>
            </div>
          )}
        </div>
        <p className={styles.legal}>{t.legal}</p>
      </footer>

      {nav.length > 1 && (
        <nav className={styles.bottomNav} aria-label={t.mainNav}>
          {nav.map((n) => (
            <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
