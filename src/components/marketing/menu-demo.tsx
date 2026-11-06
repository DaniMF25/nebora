"use client";

import { useState } from "react";
import { DEMO_LANG_LABELS, DEMO_LANGS, DEMO_MENU, type DemoLang } from "./demo-data";
import styles from "./marketing.module.css";

/** Carta de la demo en el móvil (D-065): la misma carta en cuatro idiomas, como la ve el cliente. */
export function MenuDemo() {
  const [lang, setLang] = useState<DemoLang>("es");
  return (
    <div className={styles.menuDemo}>
      <div className={styles.langs} role="group" aria-label="Idioma de la carta">
        {DEMO_LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={l === lang} onClick={() => setLang(l)} lang={l}>
            {DEMO_LANG_LABELS[l]}
          </button>
        ))}
      </div>
      <div className={styles.handset}>
        <div className={styles.handsetScreen} lang={lang}>
          <p className={styles.menuPlace}>La Lonja del Puerto</p>
          {DEMO_MENU.map((s) => (
            <section key={s.section.es} aria-label={s.section[lang]}>
              <h4>{s.section[lang]}</h4>
              <ul>
                {s.dishes.map((d) => (
                  <li key={d.name.es}>
                    <span className={styles.dishLine}>
                      <span>{d.name[lang]}</span>
                      <span className={styles.dots} aria-hidden="true" />
                      <span>{d.price}</span>
                    </span>
                    <small>{d.note[lang]}</small>
                    <small className={styles.allergens}>{d.allergens[lang]}</small>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
