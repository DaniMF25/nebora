"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import styles from "./site.module.css";
import { StoryCard, type StoryCardLayout } from "./story-card";

/** Historia lista para mostrar: el botón ya resuelto a un enlace de la web (o externo). */
export interface StoryView extends StoryCardLayout {
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
/** Una pulsación más corta es un toque (avanza o retrocede); más larga, una pausa mientras dura. */
const TAP_MS = 250;

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


/**
 * Historias de la portada (D-059): círculos arriba y visor a pantalla completa
 * en un <dialog> modal (foco atrapado y Esc de serie). La primera vez que un
 * navegador entra, la primera historia no vista se abre sola; lo visto se
 * recuerda en este navegador (sin cookies ni datos en el servidor). Avanza
 * sola cada pocos segundos y se cierra tras la última. Como en Instagram,
 * mantener pulsado pausa y un toque a la izquierda o a la derecha retrocede o
 * avanza (D-060); el botón de pausa, el espacio y las flechas hacen lo mismo
 * con el teclado (WCAG 2.2.2). Con menos movimiento la barra avanza a saltos
 * (CSS), pero el temporizador sigue: la preferencia pide menos animación.
 */
export function StoriesBar({ stories, texts, storageKey }: { stories: StoryView[]; texts: StoryTexts; storageKey: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const press = useRef<{ at: number; x: number; width: number; left: number } | null>(null);
  const key = `nebora:stories:${storageKey}`;
  const seenRaw = useSyncExternalStore(subscribeSeen, () => readSeenRaw(key), () => "[]");
  const seen = useMemo(() => parseSeen(seenRaw), [seenRaw]);

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
  const autoAdvance = !paused && !holding;

  // Pulsación en la tarjeta (fuera de botones y enlaces): mantener pausa; un toque navega.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("a, button")) return;
    const box = e.currentTarget.getBoundingClientRect();
    press.current = { at: performance.now(), x: e.clientX, width: box.width, left: box.left };
    setHolding(true);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    setHolding(false);
    if (!p || performance.now() - p.at > TAP_MS || Math.abs(e.clientX - p.x) > 10) return;
    go(p.x - p.left < p.width * 0.35 ? -1 : 1);
  };
  const cancelPress = () => {
    press.current = null;
    setHolding(false);
  };

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
          else if (e.key === " " && !(e.target as Element).closest("a, button")) {
            e.preventDefault();
            setPaused((p) => !p);
          }
        }}
      >
        {current && index !== null && (
          <StoryCard
            story={current}
            titleId={`historia-${current.id}`}
            className={holding ? styles.storyHolding : ""}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
            onContextMenu={(e) => e.preventDefault()}
            top={
              <>
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
                    <button
                      type="button"
                      className={styles.storyIconButton}
                      onClick={() => setPaused((p) => !p)}
                      aria-pressed={paused}
                      aria-label={paused ? texts.storyPlay : texts.storyPause}
                      title={paused ? texts.storyPlay : texts.storyPause}
                    >
                      <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.storyIconButton}
                      onClick={close}
                      aria-label={texts.storyClose}
                      title={texts.storyClose}
                      autoFocus
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </div>
                </div>
              </>
            }
            overlay={
              <>
                {index > 0 && (
                  <button
                    type="button"
                    className={`${styles.storySide} ${styles.storySidePrev}`}
                    onClick={() => go(-1)}
                    aria-label={texts.storyPrev}
                    title={texts.storyPrev}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.storySide} ${styles.storySideNext}`}
                  onClick={() => go(1)}
                  aria-label={index === stories.length - 1 ? texts.storyClose : texts.storyNext}
                  title={index === stories.length - 1 ? texts.storyClose : texts.storyNext}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </>
            }
          />
        )}
      </dialog>
    </>
  );
}
