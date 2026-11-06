import { ActionForm } from "@/components/action-form";
import { siteLook } from "@/components/site/site-shell";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { privateMediaUrl } from "@/lib/site";
import {
  MAX_STORIES,
  STORY_BODY_MAX,
  STORY_TITLE_MAX,
  type Story,
  type StoryCtaKind,
} from "@/server/modules/site/stories";
import {
  createStoryAction,
  deleteStoryAction,
  moveStoryAction,
  removeStoryImageAction,
  updateStoryAction,
} from "./actions";
import { StoryEditor } from "./story-editor";

const CTA_LABELS: Record<StoryCtaKind, string> = {
  none: "Sin botón",
  booking: "Reservar mesa",
  menu: "Ver la carta",
  contact: "Contactar",
  url: "Enlace propio",
};

const dateLabel = (d: string) =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${d}T12:00:00Z`),
  );

/** Estado de la historia hoy (en la hora del local). */
function status(s: Story, today: string): { label: string; live: boolean } {
  if (s.startsOn && s.startsOn > today) return { label: `Programada: desde el ${dateLabel(s.startsOn)}`, live: false };
  if (s.endsOn && s.endsOn < today) return { label: `Terminada el ${dateLabel(s.endsOn)}`, live: false };
  return { label: s.endsOn ? `Se ve hasta el ${dateLabel(s.endsOn)}` : "Se ve ahora", live: true };
}

/** Pestaña «Historias» de la web (D-059). */
export function StoriesTab({
  orgId,
  estId,
  stories,
  today,
  canEdit,
  published,
  planNote,
  theme,
  accentColor,
  fontPairing,
}: {
  orgId: string;
  estId: string;
  stories: Story[];
  today: string;
  canEdit: boolean;
  published: boolean;
  planNote: React.ReactNode | null;
  /** Estilo de la web (el que se publica según el plan), para la vista previa. */
  theme: MenuTheme;
  accentColor: string | null;
  fontPairing: string | null;
}) {
  const { className, style } = siteLook(theme, accentColor, fontPairing);
  const look = { className, style };
  return (
    <section>
      <h3>Historias</h3>
      {planNote && <div className="notice">{planNote}</div>}
      <p className="muted">
        Avisos que tus clientes ven nada más entrar en la web: un evento, una apertura, un cambio de horario… Salen
        como círculos arriba de la portada y la primera, la primera vez que alguien entra, se abre sola. Ponles
        fechas para que se quiten solas. Hasta {MAX_STORIES}.
      </p>
      {!published && <p className="notice">La web no está publicada: nadie verá las historias hasta que la publiques.</p>}
      {stories.length === 0 ? (
        <p className="muted">Todavía no hay historias.</p>
      ) : (
        <ol className="story-list">
          {stories.map((s, n) => {
            const st = status(s, today);
            return (
              <li key={s.id}>
                <div className="story-row">
                  {s.mediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por ruta autenticada
                    <img src={privateMediaUrl(orgId, s.mediaId)} alt="" className="story-thumb" />
                  ) : (
                    <span className="story-thumb story-thumb-empty" aria-hidden="true">
                      {s.title.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <strong>
                      {n + 1}. {s.title}
                    </strong>
                    <p className="muted">
                      <span className={st.live ? "badge badge-ok" : "badge"}>{st.label}</span>
                      {s.ctaKind !== "none" && ` · Botón: ${s.ctaKind === "url" ? s.ctaLabel : CTA_LABELS[s.ctaKind]}`}
                      {n === 0 && " · Se abre sola"}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <details>
                    <summary>Editar «{s.title}»</summary>
                    <ActionForm
                      action={updateStoryAction.bind(null, orgId, estId, s.id)}
                      submitLabel="Guardar historia"
                      className="form story-form"
                      resetOnSuccess={false}
                      secondary={{ action: deleteStoryAction.bind(null, orgId, estId, s.id), label: "Eliminar historia" }}
                    >
                      <StoryEditor
                        story={s}
                        n={n}
                        imageUrl={s.mediaId ? privateMediaUrl(orgId, s.mediaId) : null}
                        look={look}
                        titleMax={STORY_TITLE_MAX}
                        bodyMax={STORY_BODY_MAX}
                      />
                    </ActionForm>
                    <div className="inline-form">
                      {s.mediaId && (
                        <ActionForm
                          action={removeStoryImageAction.bind(null, orgId, estId, s.id)}
                          submitLabel="Quitar la foto"
                          className="inline-form"
                        />
                      )}
                      {n > 0 && (
                        <ActionForm
                          action={moveStoryAction.bind(null, orgId, estId, s.id, "up")}
                          submitLabel={`↑ Subir «${s.title}»`}
                          className="inline-form"
                        />
                      )}
                      {n < stories.length - 1 && (
                        <ActionForm
                          action={moveStoryAction.bind(null, orgId, estId, s.id, "down")}
                          submitLabel={`↓ Bajar «${s.title}»`}
                          className="inline-form"
                        />
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {canEdit && stories.length < MAX_STORIES && (
        <div className="story-new" aria-labelledby="nueva-historia" role="group">
          <h4 id="nueva-historia">Nueva historia</h4>
          <ActionForm
            action={createStoryAction.bind(null, orgId, estId)}
            submitLabel="Crear historia"
            className="form story-form"
          >
            <StoryEditor imageUrl={null} look={look} titleMax={STORY_TITLE_MAX} bodyMax={STORY_BODY_MAX} />
          </ActionForm>
        </div>
      )}
    </section>
  );
}
