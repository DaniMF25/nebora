import type { PublicLanguage } from "@/lib/languages";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import type { MenuServing as Serving } from "@/server/modules/menus/availability";
import styles from "./menu-serving.module.css";

/**
 * Horario de la carta («Se sirve: Lun – Vie 08:00 – 12:00», y aviso si ahora
 * no se sirve) y enlaces a las demás cartas del local (D-036). Hereda colores
 * y letra del estilo de la página.
 */
export function MenuServingInfo({ serving, lang = "es" }: { serving: Serving; lang?: PublicLanguage }) {
  const t = PUBLIC_TEXTS[lang];
  if (!serving.hours && serving.menus.length === 0) return null;
  return (
    <div className={styles.serving}>
      {serving.menus.length > 0 && (
        <nav className={styles.menus} aria-label={t.ourMenus}>
          {serving.menus.map((m) => (
            <a key={m.slug} href={m.href} aria-current={m.current ? "page" : undefined}>
              {m.name}
              {m.scheduledNow && !m.current && <span className={styles.now}> · {t.servedNow}</span>}
            </a>
          ))}
        </nav>
      )}
      {serving.hours && (
        <p className={styles.hours}>
          <strong>{t.servedAt}:</strong> {serving.hours.join(" · ")}
          {!serving.availableNow && <span className={styles.notNow}>{t.notServedNow}</span>}
        </p>
      )}
    </div>
  );
}
