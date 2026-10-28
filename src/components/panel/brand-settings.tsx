import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { fontClasses } from "@/components/site/fonts";
import type { FormState } from "@/lib/form-state";
import { contrastRatio } from "@/lib/color";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { LOGO_SIZE_LABELS, LOGO_SIZES, type LogoSize } from "@/lib/site";
import { pairingsFor, resolvePairing } from "@/lib/site-fonts";
import { THEME_INFO } from "@/lib/site-themes";
import styles from "./brand-settings.module.css";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Marca de la web (D-034): logotipo, color de marca y combinación
 * tipográfica del estilo elegido. Sin JavaScript: formularios normales.
 */
export function BrandSettings({
  theme,
  establishmentName,
  logoUrl,
  logoSize,
  accentColor,
  fontPairing,
  previewHref,
  canEdit,
  setLogo,
  removeLogo,
  setLogoSize,
  setBranding,
}: {
  theme: MenuTheme;
  establishmentName: string;
  logoUrl: string | null;
  logoSize: LogoSize;
  accentColor: string | null;
  fontPairing: string | null;
  previewHref: (fontId?: string) => string;
  canEdit: boolean;
  setLogo: Action;
  removeLogo: Action;
  setLogoSize: Action;
  setBranding: Action;
}) {
  const info = THEME_INFO[theme];
  const current = resolvePairing(theme, fontPairing);
  const color = accentColor ?? info.accent;
  const contrast = contrastRatio(color, info.pageBg);

  return (
    <>
      <section>
        <h3>Logotipo</h3>
        <p className="muted">
          Sustituye al nombre del local en la cabecera de la web. Mejor en PNG o WebP con fondo transparente y formato
          horizontal.
        </p>
        {logoUrl ? (
          <div className={styles.logoPreview} style={{ ["--logo-bg" as string]: info.mock.bg }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por ruta autenticada */}
            <img src={logoUrl} alt={`Logotipo de ${establishmentName}`} />
          </div>
        ) : (
          <p className="muted">Sin logotipo: se muestra el nombre del local con la letra del estilo.</p>
        )}
        {logoUrl && canEdit && (
          <div className={styles.block}>
            <ActionForm action={setLogoSize} submitLabel="Guardar tamaño">
              <fieldset>
                <legend className={styles.legend}>Tamaño en la cabecera</legend>
                <div className={styles.sizes}>
                  {LOGO_SIZES.map((size) => (
                    <label key={size} className={styles.size}>
                      <input type="radio" name="logoSize" value={size} defaultChecked={size === logoSize} />
                      <span className={styles.sizeStage} style={{ ["--logo-bg" as string]: info.mock.bg }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por ruta autenticada */}
                        <img src={logoUrl} alt="" className={styles[`size-${size}`]} />
                      </span>
                      {LOGO_SIZE_LABELS[size]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </ActionForm>
          </div>
        )}
        {canEdit && (
          <>
            <ActionForm action={setLogo} submitLabel="Subir logotipo">
              <label>
                Imagen del logotipo (PNG, WebP o JPEG, hasta 8 MB)
                <input type="file" name="image" accept="image/png,image/webp,image/jpeg" required />
              </label>
            </ActionForm>
            {logoUrl && <ActionForm action={removeLogo} submitLabel="Quitar logotipo" className="inline-form" />}
          </>
        )}
      </section>

      <section>
        <h3>Color y tipografía</h3>
        {!canEdit ? (
          <p className="muted">
            Color {accentColor ?? "del estilo"} · letra «{current.name}» ({current.description}).
          </p>
        ) : (
          <ActionForm action={setBranding} submitLabel="Guardar color y tipografía">
            <fieldset className={styles.colorField}>
              <legend>Color de marca</legend>
              <p className="muted">
                Se usa en botones, enlaces y detalles. El del estilo {info.name} es{" "}
                <span className={styles.swatch} style={{ background: info.accent }} aria-hidden="true" /> {info.accent}.
              </p>
              <label className="check">
                <input type="checkbox" name="customAccent" value="1" defaultChecked={accentColor !== null} />
                Usar mi color de marca
              </label>
              <label className={styles.colorInput}>
                Color
                <input type="color" name="accentColor" defaultValue={color} />
              </label>
              {accentColor && contrast < 3 && (
                <p className="notice" role="status">
                  Este color contrasta poco con el fondo del estilo ({contrast.toFixed(1)}:1): los enlaces y botones
                  pueden costar de leer. Prueba uno más {info.pageBg === "#0a0a14" ? "claro" : "oscuro"}.
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className={styles.legend}>Tipografía del estilo {info.name}</legend>
              <div className={styles.pairings}>
                {pairingsFor(theme).map((p) => (
                  <label key={p.id} className={`${styles.pairing} ${fontClasses(p.fonts)}`}>
                    <input type="radio" name="fontPairing" value={p.id} defaultChecked={p.id === current.id} />
                    <span className={styles.sample} style={{ fontFamily: p.brand ?? p.display }}>
                      {establishmentName}
                    </span>
                    <span className={styles.sampleBody} style={{ fontFamily: p.body }}>
                      Pulpo a la brasa con parmentier · 16,50 €
                    </span>
                    <span className={styles.pairingName}>
                      {p.name} <span className="muted">· {p.description}</span>
                    </span>
                    <Link href={previewHref(p.id)} target="_blank" rel="noopener" className={styles.previewLink}>
                      Vista previa
                    </Link>
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        )}
        <p className="muted">
          Al cambiar de estilo se usa la tipografía original del nuevo estilo hasta que elijas otra.{" "}
          <Link href={previewHref()} target="_blank" rel="noopener">
            Ver la web con la marca guardada
          </Link>
        </p>
      </section>
    </>
  );
}
