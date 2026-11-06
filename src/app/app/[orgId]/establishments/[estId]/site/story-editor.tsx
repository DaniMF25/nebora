"use client";

import { useEffect, useState } from "react";
import styles from "@/components/site/site.module.css";
import { StoryCard, type StoryCardLayout } from "@/components/site/story-card";

type CtaKind = "none" | "booking" | "menu" | "contact" | "url";

export interface StoryEditorValues extends StoryCardLayout {
  title: string;
  body: string | null;
  ctaKind: CtaKind;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

const CTA_LABELS: Record<CtaKind, string> = {
  none: "Sin botón",
  booking: "Reservar mesa",
  menu: "Ver la carta",
  contact: "Contactar",
  url: "Enlace propio",
};
// Texto del botón en la web (en español; la web lo traduce al idioma del visitante).
const CTA_PREVIEW: Record<Exclude<CtaKind, "none" | "url">, string> = {
  booking: "Reservar",
  menu: "Ver la carta",
  contact: "Contactar",
};

/**
 * Campos de una historia con vista previa en directo (D-060): la misma tarjeta
 * que verá el cliente, con el estilo y el color de la web, la foto elegida
 * (antes de subirla) y la ubicación del texto y del botón.
 */
export function StoryEditor({
  story,
  n,
  imageUrl,
  look,
  titleMax,
  bodyMax,
}: {
  story?: StoryEditorValues;
  /** Número de la historia en la lista (para que cada campo tenga un nombre único). */
  n?: number;
  imageUrl: string | null;
  look: { className: string; style: Record<string, string> };
  titleMax: number;
  bodyMax: number;
}) {
  const suffix = n === undefined ? "" : ` (historia ${n + 1})`;
  const [v, setV] = useState({
    title: story?.title ?? "",
    body: story?.body ?? "",
    ctaKind: story?.ctaKind ?? "none",
    ctaLabel: story?.ctaLabel ?? "",
    textPosition: story?.textPosition ?? "bottom",
    textAlign: story?.textAlign ?? "left",
    ctaPosition: story?.ctaPosition ?? "text",
  });
  const [picked, setPicked] = useState<string | null>(null);
  // La foto elegida se ve antes de subirla; se libera al cambiarla o al salir.
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked) : undefined), [picked]);
  // El valor se lee en el momento: cuando React aplica el cambio, el evento ya no tiene campo.
  const set = <K extends keyof typeof v>(key: K) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setV((prev) => ({ ...prev, [key]: value }));
  };

  const ctaLabel =
    v.ctaKind === "none" ? null : v.ctaKind === "url" ? v.ctaLabel.trim() || "Texto del botón" : CTA_PREVIEW[v.ctaKind];

  return (
    <div className="story-editor">
      <div className="story-editor-fields">
        <label>
          Titular{suffix}
          <input
            name="title"
            required
            maxLength={titleMax}
            defaultValue={story?.title}
            placeholder="Nueva terraza"
            onInput={set("title")}
          />
        </label>
        <label>
          Texto (opcional){suffix}
          <textarea
            name="body"
            rows={3}
            maxLength={bodyMax}
            defaultValue={story?.body ?? ""}
            placeholder="Desde este viernes, cenas al aire libre."
            onInput={set("body")}
          />
        </label>
        <label>
          {imageUrl ? `Cambiar la foto${suffix}` : `Foto (opcional)${suffix}`}
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              setPicked(file ? URL.createObjectURL(file) : null);
            }}
          />
        </label>
        <div className="inline-form">
          <label>
            Botón{suffix}
            <select name="ctaKind" defaultValue={v.ctaKind} onChange={set("ctaKind")}>
              {(Object.keys(CTA_LABELS) as CtaKind[]).map((k) => (
                <option key={k} value={k}>
                  {CTA_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          {(v.ctaKind === "booking" || v.ctaKind === "menu") && (
            <p className="muted field-note">
              {v.ctaKind === "booking"
                ? "Solo se ve en la web si tienes activadas las reservas online."
                : "Solo se ve en la web si hay alguna carta publicada."}
            </p>
          )}
          {v.ctaKind === "url" && (
            <>
              <label>
                Texto del botón{suffix}
                <input
                  name="ctaLabel"
                  maxLength={30}
                  defaultValue={story?.ctaLabel ?? ""}
                  placeholder="Ver el evento"
                  onInput={set("ctaLabel")}
                />
              </label>
              <label>
                Enlace{suffix}
                <input name="ctaUrl" type="url" maxLength={500} defaultValue={story?.ctaUrl ?? ""} placeholder="https://" />
              </label>
            </>
          )}
        </div>
        <fieldset className="story-layout">
          <legend>Ubicación{suffix}</legend>
          <label>
            Posición del texto
            <select name="textPosition" defaultValue={v.textPosition} onChange={set("textPosition")}>
              <option value="top">Arriba</option>
              <option value="center">En el centro</option>
              <option value="bottom">Abajo</option>
            </select>
          </label>
          <label>
            Alineación del texto
            <select name="textAlign" defaultValue={v.textAlign} onChange={set("textAlign")}>
              <option value="left">A la izquierda</option>
              <option value="center">Centrado</option>
            </select>
          </label>
          <label>
            Posición del botón
            <select name="ctaPosition" defaultValue={v.ctaPosition} onChange={set("ctaPosition")}>
              <option value="text">Junto al texto</option>
              <option value="bottom">Abajo del todo</option>
            </select>
          </label>
        </fieldset>
        <div className="inline-form">
          <label>
            Desde (opcional){suffix}
            <input type="date" name="startsOn" defaultValue={story?.startsOn ?? ""} />
          </label>
          <label>
            Hasta (opcional){suffix}
            <input type="date" name="endsOn" defaultValue={story?.endsOn ?? ""} />
          </label>
        </div>
      </div>
      <figure className="story-editor-preview">
        {/* Solo visual: duplica lo que ya dicen los campos. */}
        <div className={`${look.className} ${styles.storyPreviewSite}`} style={look.style} aria-hidden="true">
          <div className={styles.storyHeroContext}>
            <StoryCard
              className={styles.storyPreview}
              story={{
                title: v.title.trim() || "Titular de la historia",
                body: v.body.trim() || null,
                imageUrl: picked ?? imageUrl,
                cta: ctaLabel ? { label: ctaLabel } : null,
                textPosition: v.textPosition as StoryCardLayout["textPosition"],
                textAlign: v.textAlign as StoryCardLayout["textAlign"],
                ctaPosition: v.ctaPosition as StoryCardLayout["ctaPosition"],
              }}
              top={
                <div className={styles.storyProgress}>
                  <span>
                    <span style={{ width: "40%" }} />
                  </span>
                </div>
              }
            />
          </div>
        </div>
        <figcaption className="muted">Vista previa: así la verán tus clientes en el móvil.</figcaption>
      </figure>
    </div>
  );
}
