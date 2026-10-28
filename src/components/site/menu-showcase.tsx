"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuSnapshot } from "@/lib/menu-snapshot";
import { formatEuros } from "@/lib/money";
import type { PublicTexts } from "@/lib/public-i18n";
import { publicMediaUrl } from "@/lib/site";
import styles from "./site.module.css";

type Item = MenuSnapshot["sections"][number]["items"][number];

interface Props {
  sections: MenuSnapshot["sections"];
  fullMenuHref: string;
  texts: PublicTexts;
}

const MAX_CARDS = 12;

/**
 * Pestañas por categoría y carrusel de platos de la carta publicada. Solo
 * reorganiza datos de la instantánea: no hay acciones de servidor.
 */
export function MenuShowcase({ sections, fullMenuHref, texts: t }: Props) {
  const recommended = sections.flatMap((s) => s.items.filter((i) => i.recommended));
  const tabs: { name: string; items: Item[] }[] = [
    ...(recommended.length > 0 ? [{ name: t.recommendedTab, items: recommended }] : []),
    ...sections.filter((s) => s.items.length > 0),
  ];
  const [tab, setTab] = useState(0);
  const [active, setActive] = useState(0);
  const track = useRef<HTMLUListElement>(null);
  // Los puntos solo tienen sentido si los platos no caben y hay que desplazarse.
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);
  const current = tabs[tab] ?? tabs[0];
  if (!current) return null;
  // Con foto primero: el carrusel luce más; el orden de la carta se mantiene dentro de cada grupo.
  const items = [...current.items].sort((a, b) => Number(!!b.imageId) - Number(!!a.imageId)).slice(0, MAX_CARDS);

  function selectTab(n: number) {
    setTab(n);
    setActive(0);
    track.current?.scrollTo({ left: 0 });
  }

  function onScroll() {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    setActive(Math.round(el.scrollLeft / (first.offsetWidth + 16)));
  }

  function goTo(n: number) {
    const el = track.current;
    const card = el?.children[n] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }

  return (
    <>
      {tabs.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label={t.menuCategories}>
          {tabs.map((t, n) => (
            <button
              key={t.name}
              type="button"
              role="tab"
              aria-selected={n === tab}
              className={styles.tab}
              onClick={() => selectTab(n)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <ul className={styles.cards} ref={track} onScroll={onScroll} aria-label={`${t.dishes}: ${current.name}`}>
        {items.map((item, n) => (
          <li key={`${current.name}-${n}`} className={`${styles.card} ${item.imageId ? "" : styles.cardNoImage}`}>
            {item.imageId && (
              // eslint-disable-next-line @next/next/no-img-element -- imagen ya reducida y servida por la app
              <img className={styles.cardImage} src={publicMediaUrl(item.imageId)} alt={item.name} loading="lazy" />
            )}
            <div className={styles.cardBody}>
              {item.recommended && <p className={styles.cardBadge}>{t.recommended}</p>}
              <h3 className={styles.cardTitle}>{item.name}</h3>
              <p className={styles.cardPrice}>{formatEuros(item.priceCents)}</p>
              {item.description && <p className={styles.cardText}>{item.description}</p>}
              {item.allergens.length > 0 && (
                <p className={styles.cardAllergens}>
                  {t.allergens}: {item.allergens.map((a) => t.allergenNames[a]).join(", ")}
                </p>
              )}
              <a className={styles.cardLink} href={fullMenuHref}>
                {t.seeInMenu}
              </a>
            </div>
          </li>
        ))}
      </ul>
      {overflowing && items.length > 1 && (
        <div className={styles.dots}>
          {items.map((item, n) => (
            <button
              key={n}
              type="button"
              className={styles.dot}
              aria-label={`${t.see} ${item.name}`}
              aria-current={n === active ? "true" : undefined}
              onClick={() => goTo(n)}
            />
          ))}
        </div>
      )}
    </>
  );
}
