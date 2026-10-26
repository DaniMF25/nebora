import type { TranslationStatus } from "@/server/modules/translations/service";

const STATUS: Record<TranslationStatus, { label: string; className: string }> = {
  done: { label: "Traducido", className: "badge badge-ok" },
  stale: { label: "Revisar: el original ha cambiado", className: "badge badge-warn" },
  missing: { label: "Sin traducir", className: "badge" },
};

export function TranslationStatusBadge({ status }: { status: TranslationStatus }) {
  const s = STATUS[status];
  return <span className={s.className}>{s.label}</span>;
}

/**
 * Un campo traducible: el texto original en español y la traducción. Vacío =
 * sin traducir (en la web se muestra el español).
 */
export function TranslationInput({
  name,
  label,
  source,
  value,
  max,
  multiline = false,
  readOnly = false,
}: {
  name: string;
  label: string;
  source: string | null | undefined;
  value: string;
  max: number;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  if (!source) return null;
  return (
    <label className="translation-input">
      {label}
      <span className="translation-source" lang="es">
        {source}
      </span>
      {multiline ? (
        <textarea name={name} defaultValue={value} maxLength={max} rows={2} readOnly={readOnly} />
      ) : (
        <input name={name} defaultValue={value} maxLength={max} readOnly={readOnly} />
      )}
    </label>
  );
}
