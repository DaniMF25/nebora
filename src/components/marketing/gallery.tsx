"use client";

import { useRef } from "react";
import styles from "./marketing.module.css";

export interface Shot {
  src: string;
  alt: string;
  title: string;
  text: string;
  width?: number;
  height?: number;
}

/** Capturas del panel en una tira desplazable con botones (D-065). */
export function Gallery({ shots }: { shots: Shot[] }) {
  const strip = useRef<HTMLUListElement>(null);
  const move = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const item = el.querySelector("li");
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * ((item?.clientWidth ?? 600) + 24), behavior: smooth ? "smooth" : "auto" });
  };
  return (
    <div className={styles.gallery}>
      <div className={styles.galleryNav}>
        <button type="button" onClick={() => move(-1)} aria-label="Captura anterior">
          ←
        </button>
        <button type="button" onClick={() => move(1)} aria-label="Captura siguiente">
          →
        </button>
      </div>
      <ul ref={strip} className={styles.strip} tabIndex={0} aria-label="Capturas del panel">
        {shots.map((s) => (
          <li key={s.src}>
            <figure>
              <div className={styles.frame}>
                {/* eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP) */}
                <img src={s.src} alt={s.alt} width={s.width ?? 1600} height={s.height ?? 1000} loading="lazy" decoding="async" />
              </div>
              <figcaption>
                <strong>{s.title}</strong> {s.text}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}
