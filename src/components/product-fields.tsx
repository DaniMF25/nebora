import { ALLERGENS, ALLERGEN_LABELS, type Allergen } from "@/lib/allergens";
import { centsToInput } from "@/lib/money";

interface Props {
  idPrefix: string;
  defaults?: { name: string; description: string | null; priceCents: number; allergens: Allergen[]; active: boolean };
}

/** Campos del formulario de producto (alta y edición). */
export function ProductFields({ idPrefix, defaults }: Props) {
  return (
    <>
      <label>
        Nombre
        <input name="name" required maxLength={120} defaultValue={defaults?.name} />
      </label>
      <label>
        Descripción (opcional)
        <input name="description" maxLength={500} defaultValue={defaults?.description ?? ""} />
      </label>
      <label>
        Precio (€)
        <input
          name="price"
          inputMode="decimal"
          required
          placeholder="12,50"
          defaultValue={defaults ? centsToInput(defaults.priceCents) : ""}
        />
      </label>
      <fieldset className="allergens">
        <legend>Alérgenos</legend>
        {ALLERGENS.map((a) => (
          <label key={a} className="inline-form" htmlFor={`${idPrefix}-${a}`}>
            <input
              id={`${idPrefix}-${a}`}
              type="checkbox"
              name="allergens"
              value={a}
              defaultChecked={defaults?.allergens.includes(a)}
            />
            {ALLERGEN_LABELS[a]}
          </label>
        ))}
      </fieldset>
      {defaults && (
        <label className="inline-form">
          <input type="checkbox" name="active" defaultChecked={defaults.active} /> Disponible (desmarcar para archivar)
        </label>
      )}
    </>
  );
}
