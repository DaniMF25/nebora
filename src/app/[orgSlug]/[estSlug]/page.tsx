import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Icon } from "@/components/site/icons";
import { MenuShowcase } from "@/components/site/menu-showcase";
import { SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { publicMediaUrl } from "@/lib/site";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSite } from "@/server/modules/site/service";

type Params = Promise<{ orgSlug: string; estSlug: string }>;

// Página pública sin sesión: solo lee el perfil publicado y la carta publicada.
const load = cache(async (org: string, est: string) => {
  const site = await getPublicSite(org, est);
  if (!site) return null;
  const menu = site.featuredMenuSlug ? await getPublishedMenu(org, est, site.featuredMenuSlug) : null;
  return { site, menu };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) return { title: "Página no encontrada" };
  return {
    title: data.site.tagline ? `${data.site.establishmentName} · ${data.site.tagline}` : data.site.establishmentName,
    description: data.site.heroText ?? undefined,
  };
}

export default async function PublicSitePage({ params }: { params: Params }) {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) notFound();
  const { site, menu } = data;
  const org = orgSlug.toLowerCase();
  const est = estSlug.toLowerCase();
  const menuHref = menu && site.featuredMenuSlug ? `/m/${org}/${est}/${site.featuredMenuSlug}` : null;
  const bookingHref = site.bookingEnabled ? `/r/${org}/${est}` : null;

  return (
    <SiteShell
      current="home"
      site={{ ...site, links: { home: `/${org}/${est}`, menu: menuHref, booking: bookingHref } }}
    >
      <section
        className={`${styles.hero} ${site.heroMediaId ? styles.heroWithImage : ""}`}
        style={site.heroMediaId ? { ["--hero-image" as string]: `url(${publicMediaUrl(site.heroMediaId)})` } : undefined}
      >
        <div className={styles.heroInner}>
          {site.heroEyebrow && <p className={styles.eyebrow}>{site.heroEyebrow}</p>}
          <h1 className={styles.heroTitle}>{site.heroTitle}</h1>
          <span className={styles.rule} aria-hidden="true" />
          {site.heroText && <p className={styles.heroText}>{site.heroText}</p>}
          <div className={styles.heroActions}>
            {bookingHref && (
              <Link href={bookingHref} className={styles.buttonPrimary}>
                Reservar mesa
              </Link>
            )}
            <a href="#contacto" className={styles.buttonGhost}>
              Ver horarios <Icon name="arrow" className={styles.buttonIcon} />
            </a>
          </div>
        </div>
      </section>

      {menu && menuHref && (
        <section className={styles.menuBlock} aria-labelledby="nuestra-carta">
          <div className={styles.blockHead}>
            <h2 id="nuestra-carta" className={styles.blockTitle}>
              Nuestra carta
            </h2>
            <Link href={menuHref} className={styles.textLink}>
              Ver carta completa <Icon name="arrow" className={styles.buttonIcon} />
            </Link>
          </div>
          <MenuShowcase sections={menu.snapshot.sections} fullMenuHref={menuHref} />
        </section>
      )}

      {site.highlights.length > 0 && (
        <section className={styles.highlights} aria-label="Lo que nos define">
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
  );
}
