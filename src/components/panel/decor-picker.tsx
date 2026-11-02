import { ActionForm } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";
import { DECOR_INFO, decorCssUrl, SITE_DECORS, type SiteDecor } from "@/lib/site-decor";
import styles from "./decor-picker.module.css";

/**
 * Fondo decorativo de la web (D-050): ninguno o un motivo según el tipo de
 * cocina, con muestra. Sin `save` (sin permiso o sin plan) se ve deshabilitado.
 */
export function DecorPicker({
  current,
  save,
  locked,
  previewHref,
}: {
  current: SiteDecor | null;
  save?: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Aviso del plan: las opciones se muestran deshabilitadas con este texto. */
  locked?: React.ReactNode;
  previewHref: (decor: SiteDecor) => string;
}) {
  const options = (
    <fieldset className={styles.options} disabled={!save}>
      <legend className="visually-hidden">Fondo decorativo</legend>
      <label className={styles.option}>
        <input type="radio" name="decor" value="" defaultChecked={current === null} />
        <span className={`${styles.sample} ${styles.none}`} aria-hidden="true" />
        <strong>Sin fondo</strong>
        <span className="muted">Solo el color del estilo</span>
      </label>
      {SITE_DECORS.map((d) => (
        <label key={d} className={styles.option}>
          <input type="radio" name="decor" value={d} defaultChecked={current === d} />
          <span className={styles.sample} style={{ ["--decor" as string]: decorCssUrl(d) }} aria-hidden="true" />
          <strong>{DECOR_INFO[d].name}</strong>
          <span className="muted">{DECOR_INFO[d].description}</span>
          <a href={previewHref(d)} target="_blank" rel="noopener" className={styles.preview}>
            Vista previa<span className="visually-hidden"> de {DECOR_INFO[d].name}</span>
          </a>
        </label>
      ))}
    </fieldset>
  );
  return (
    <section>
      <h3>Fondo decorativo</h3>
      <p className="muted">
        Un dibujo muy sutil según tu tipo de cocina, en el color del estilo. No cambia el fondo ni tapa los textos, y no
        se ve sobre la foto principal ni en el pie.
      </p>
      {locked && <div className={`notice ${styles.note}`}>{locked}</div>}
      {save ? (
        <ActionForm action={save} submitLabel="Guardar fondo" resetOnSuccess={false} className="form form-wide">
          {options}
        </ActionForm>
      ) : (
        <div className={styles.locked}>{options}</div>
      )}
    </section>
  );
}
