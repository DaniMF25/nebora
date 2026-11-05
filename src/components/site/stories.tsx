"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import styles from "./site.module.css";

/** Historia lista para mostrar: el botón ya resuelto a un enlace de la web (o externo). */
export interface StoryView {
  id: string;
  version: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  cta: { href: string; label: string; external: boolean } | null;
}

export interface StoryTexts {
  stories: string;
  storyOpen: string;
  storyClose: string;
  storyPrev: string;
  storyNext: string;
  storyPause: string;
  storyPlay: string;
  storyCount: string;
}

/** Segundos que se muestra cada historia antes de pasar a la siguiente. */
const SECONDS = 7;

// Lo visto se guarda en localStorage y se lee con useSyncExternalStore: en el
// servidor (y en la primera pintura) no hay nada visto, y luego se sincroniza.
const listeners = new Set<() => void>();
function subscribeSeen(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readSeenRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseSeen(raw: string): Set<string> {
  try {
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}
function markSeen(key: string, version: string): void {
  const seen = parseSeen(readSeenRaw(key));
  if (seen.has(version)) return;
  seen.add(version);
  try {
    window.localStorage.setItem(key, JSON.stringify([...seen].slice(-50)));
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): solo deja de recordarse qué se vio.
  }
  for (const cb of listeners) cb();
}

function subscribeMotion(cb: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
}
const reducedMotionNow = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Historias de la portada (D-059): círculos arriba y visor a pantalla completa
 * en un <dialog> modal (foco atrapado y Esc de serie). La primera vez que un
 * navegador entra, la primera historia no vista se abre sola; lo visto se
 * recuerda en este navegador (sin cookies ni datos en el servidor). Avanza
 * sola salvo si se pausa o el sistema pide menos movimiento.
 */
export function StoriesBar({ stories, texts, storageKey }: { stories: StoryView[]; texts: StoryTexts; storageKey: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const key = `nebora:stories:${storageKey}`;
  const seenRaw = useSyncExternalStore(subscribeSeen, () => readSeenRaw(key), () => "[]");
  const seen = useMemo(() => parseSeen(seenRaw), [seenRaw]);
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionNow, () => false);

  const show = useCallback(
    (n: number) => {
      const story = stories[n];
      if (!story) return;
      setIndex(n);
      setPaused(false);
      markSeen(key, story.version);
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
    },
    [stories, key],
  );

  // Al cargar: si la primera historia no se ha visto en este navegador, se abre sola.
  useEffect(() => {
    const first = stories[0];
    if (!first || parseSeen(readSeenRaw(key)).has(first.version)) return;
    const frame = requestAnimationFrame(() => show(0));
    return () => cancelAnimationFrame(frame);
  }, [stories, key, show]);

  const close = () => dialogRef.current?.close();
  const go = (delta: number) => {
    if (index === null) return;
    const n = index + delta;
    if (n < 0) return;
    if (n >= stories.length) close();
    else show(n);
  };

  if (stories.length === 0) return null;
  const current = index === null ? null : stories[index];
  const fill = (t: string, values: Record<string, string | number>) =>
    t.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
  const autoAdvance = !paused && !reducedMotion;

  return (
    <>
      <nav className={styles.storyStrip} aria-label={texts.stories}>
        <ul>
          {stories.map((s, n) => (
            <li key={s.id}>
              <button
                type="button"
                className={`${styles.storyBubble} ${seen.has(s.version) ? styles.storySeen : ""}`}
                onClick={() => show(n)}
                aria-label={fill(texts.storyOpen, { title: s.title })}
              >
                <span className={styles.storyRing} aria-hidden="true">
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen pública de la web (ruta propia, sin optimizador)
                    <img src={s.imageUrl} alt="" />
                  ) : (
                    <span className={styles.storyInitial}>{s.title.trim().charAt(0).toUpperCase()}</span>
                  )}
                </span>
                <span className={styles.storyName} aria-hidden="true">
                  {s.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        className={styles.storyDialog}
        aria-labelledby={current ? `historia-${current.id}` : undefined}
        onClose={() => setIndex(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
        }}
      >
        {current && index !== null && (
          <div className={`${styles.storyCard} ${current.imageUrl ? styles.storyWithImage : ""}`}>
            {current.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- imagen pública de la web
              <img src={current.imageUrl} alt="" className={styles.storyImage} />
            )}
            <div className={styles.storyProgress} aria-hidden="true">
              {stories.map((s, n) => (
                <span key={s.id}>
                  <span
                    // Al cambiar de historia se reinicia la animación (key) y, al terminar, pasa a la siguiente.
                    key={n === index ? `${s.id}-run` : s.id}
                    className={n < index ? styles.storyBarDone : n === index ? styles.storyBarNow : undefined}
                    style={
                      n === index
                        ? {
                            animationDuration: `${SECONDS}s`,
                            animationPlayState: autoAdvance ? "running" : "paused",
                          }
                        : undefined
                    }
                    onAnimationEnd={n === index ? () => go(1) : undefined}
                  />
                </span>
              ))}
            </div>
            <div className={styles.storyTop}>
              <p className={styles.storyCount}>{fill(texts.storyCount, { n: index + 1, total: stories.length })}</p>
              <div className={styles.storyControls}>
                {!reducedMotion && (
                  <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
                    {paused ? texts.storyPlay : texts.storyPause}
                  </button>
                )}
                <button type="button" onClick={close} autoFocus>
                  {texts.storyClose}
                </button>
              </div>
            </div>
            <div className={styles.storyContent}>
              <h2 id={`historia-${current.id}`} className={styles.storyTitle}>
                {current.title}
              </h2>
              {current.body && <p className={styles.storyBody}>{current.body}</p>}
              {current.cta && (
                <a
                  href={current.cta.href}
                  className={styles.buttonPrimary}
                  {...(current.cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {current.cta.label}
                </a>
              )}
            </div>
            <div className={styles.storyNav}>
              <button type="button" onClick={() => go(-1)} disabled={index === 0}>
                ← {texts.storyPrev}
              </button>
              <button type="button" onClick={() => go(1)}>
                {index === stories.length - 1 ? texts.storyClose : texts.storyNext} →
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
