"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./marketing.module.css";

export interface TourStep {
  id: string;
  label: string;
  title: string;
  text: string;
  plan: string;
  image: { src: string; alt: string; width: number; height: number };
}

const STEP_MS = 7000;

/**
 * Recorrido por el panel con capturas reales (D-064): pestañas accesibles que
 * avanzan solas cada pocos segundos hasta que la persona elige una. Sin
 * avance automático si prefiere menos movimiento o si el recorrido no se ve.
 */
export function Tour({ steps }: { steps: TourStep[] }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Avanza solo mientras está a la vista y nadie ha tocado las pestañas.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !root.current) return;
    const io = new IntersectionObserver(([e]) => setAuto(Boolean(e?.isIntersecting)), { threshold: 0.4 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % steps.length), STEP_MS);
    return () => clearTimeout(t);
  }, [auto, active, steps.length]);

  const choose = (i: number, focus = false) => {
    setAuto(false);
    // Una vez elegida una pestaña, el recorrido deja de avanzar solo.
    root.current?.setAttribute("data-stopped", "");
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };
  const stopped = () => root.current?.hasAttribute("data-stopped");

  return (
    <div
      ref={root}
      onMouseEnter={() => setAuto(false)}
      onMouseLeave={() => !stopped() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && setAuto(true)}
    >
      <div className={styles.tourTabs} role="tablist" aria-label="Secciones del panel">
        {steps.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${s.id}`}
            tabIndex={i === active ? 0 : -1}
            className={styles.tourTab}
            onClick={() => choose(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") choose((i + 1) % steps.length, true);
              else if (e.key === "ArrowLeft") choose((i - 1 + steps.length) % steps.length, true);
              else if (e.key === "Home") choose(0, true);
              else if (e.key === "End") choose(steps.length - 1, true);
              else return;
              e.preventDefault();
            }}
          >
            {s.label}
            {auto && i === active && (
              <span
                key={active}
                className={styles.progress}
                style={{ "--tour-ms": `${STEP_MS}ms` } as React.CSSProperties}
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>
      {steps.map((s, i) => (
        <div
          key={s.id}
          role="tabpanel"
          id={`panel-${s.id}`}
          aria-labelledby={`tab-${s.id}`}
          hidden={i !== active}
          className={styles.tourPanel}
        >
          <div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <p className={styles.tourPlan}>{s.plan}</p>
          </div>
          <div className={styles.shot}>
            {/* eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP) */}
            <img
              src={s.image.src}
              alt={s.image.alt}
              width={s.image.width}
              height={s.image.height}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
