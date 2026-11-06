import type { ReactNode } from "react";
import styles from "./site.module.css";

/** Ubicación del texto y del botón en la tarjeta (D-060). */
export interface StoryCardLayout {
  textPosition: "top" | "center" | "bottom";
  textAlign: "left" | "center";
  ctaPosition: "text" | "bottom";
}

export interface StoryCardContent extends StoryCardLayout {
  title: string;
  body: string | null;
  imageUrl: string | null;
  /** Botón: `href` ausente en la vista previa del panel (no navega). */
  cta: { href?: string; label: string; external?: boolean } | null;
}

const POSITION = { top: styles.storyAtTop, center: styles.storyAtCenter, bottom: styles.storyAtBottom };
// El velo de la foto se oscurece donde va el texto.
const VEIL = { top: styles.storyVeilTop, center: styles.storyVeilCenter, bottom: "" };

/**
 * Tarjeta de una historia: la usan el visor de la web y la vista previa del
 * panel, así que lo que se ve al editar es lo que verá el cliente. El visor
 * añade la barra de progreso, los controles y la navegación.
 */
export function StoryCard({
  story,
  titleId,
  top,
  overlay,
  className = "",
  ...events
}: {
  story: StoryCardContent;
  titleId?: string;
  /** Barra de progreso y controles de arriba. */
  top?: ReactNode;
  /** Capas encima del contenido (navegación lateral del visor). */
  overlay?: ReactNode;
  className?: string;
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onPointerLeave" | "onContextMenu"
>) {
  const button = story.cta ? (
    story.cta.href ? (
      <a
        href={story.cta.href}
        className={styles.buttonPrimary}
        {...(story.cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {story.cta.label}
      </a>
    ) : (
      <span className={styles.buttonPrimary}>{story.cta.label}</span>
    )
  ) : null;
  return (
    <div
      className={`${styles.storyCard} ${story.imageUrl ? `${styles.storyWithImage} ${VEIL[story.textPosition]}` : ""} ${className}`}
      {...events}
    >
      {story.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- imagen de la web (ruta propia, sin optimizador)
        <img src={story.imageUrl} alt="" className={styles.storyImage} draggable={false} />
      )}
      <div className={styles.storyHeader}>{top}</div>
      <div
        className={`${styles.storyContent} ${POSITION[story.textPosition]} ${
          story.textAlign === "center" ? styles.storyCentered : ""
        }`}
      >
        <h2 id={titleId} className={styles.storyTitle}>
          {story.title}
        </h2>
        {story.body && <p className={styles.storyBody}>{story.body}</p>}
        {story.ctaPosition === "text" && button}
      </div>
      <div className={`${styles.storyFooter} ${story.textAlign === "center" ? styles.storyCentered : ""}`}>
        {story.ctaPosition === "bottom" && button}
      </div>
      {overlay}
    </div>
  );
}
