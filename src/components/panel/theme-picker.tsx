import { ActionForm } from "@/components/action-form";
import { themeFontClasses } from "@/components/site/fonts";
import type { FormState } from "@/lib/form-state";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { THEME_INFO, THEME_ORDER } from "@/lib/site-themes";
import styles from "./theme-picker.module.css";

interface Props {
  current: MenuTheme;
  /** Datos reales para la miniatura. */
  brand: string;
  tagline: string | null;
  title: string;
  heroImageUrl: string | null;
  previewHref: (theme: MenuTheme) => string;
  /** Acción para elegir estilo; sin ella (sin permiso) solo se muestran. */
  choose?: (theme: MenuTheme) => (state: FormState, formData: FormData) => Promise<FormState>;
}

/** Estilos de la web del local como tarjetas con miniatura, colores y acciones. */
export function ThemePicker({ current, brand, tagline, title, heroImageUrl, previewHref, choose }: Props) {
  return (
    <div className={styles.grid}>
      {THEME_ORDER.map((theme) => {
        const info = THEME_INFO[theme];
        const m = info.mock;
        const hero = heroImageUrl
          ? `linear-gradient(180deg, rgb(${m.tint} / 0.1), rgb(${m.tint} / 0.92) 70%), url(${heroImageUrl}) center / cover`
          : `radial-gradient(circle at 80% 20%, ${m.accent}55, transparent 55%), ${m.bg}`;
        const isCurrent = theme === current;
        return (
          <article
            key={theme}
            className={`${styles.card} ${isCurrent ? styles.current : ""}`}
            aria-label={`Estilo ${info.name}`}
          >
            <div
              className={`${styles.stage} ${themeFontClasses(theme)} ${m.uppercase ? styles.upper : ""}`}
              style={
                {
                  "--stage": `linear-gradient(160deg, ${info.swatches[1]}33, ${info.swatches[0]}22)`,
                  "--mock-bg": m.bg,
                  "--mock-fg": m.fg,
                  "--mock-accent": m.accent,
                  "--mock-hero": hero,
                  "--mock-brand": m.brandFont,
                  "--mock-display": m.displayFont,
                } as React.CSSProperties
              }
              aria-hidden="true"
            >
              <div className={styles.phone}>
                <div className={styles.screenTop}>
                  <span className={styles.brand}>{brand}</span>
                  {tagline && <span className={styles.tagline}>{tagline}</span>}
                </div>
                <div className={styles.hero}>
                  <p className={styles.title}>{title}</p>
                  <span className={styles.cta}>Ver carta</span>
                </div>
              </div>
            </div>
            <div className={styles.body}>
              <h3 className={styles.name}>
                {info.name}
                {isCurrent && <span className="badge badge-ok">Actual</span>}
              </h3>
              <p className={styles.description}>{info.description}</p>
              <ul className={styles.swatches} aria-label={`Colores del estilo ${info.name}`}>
                {info.swatches.map((c) => (
                  <li key={c} style={{ background: c }} title={c} />
                ))}
              </ul>
              <div className={styles.actions}>
                <a href={previewHref(theme)} target="_blank" rel="noopener" className={styles.preview}>
                  Vista previa
                  <span className="visually-hidden"> del estilo {info.name}</span>
                </a>
                {choose && !isCurrent && (
                  <ActionForm action={choose(theme)} submitLabel={`Usar ${info.name}`} className="inline-form" />
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
