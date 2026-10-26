/**
 * Elección de locales de un miembro: todos o solo algunos. Funciona sin
 * JavaScript (radio + casillas); el servidor valida la elección.
 */
export function EstablishmentScopeFields({
  establishments,
  allSelected,
  selected,
  idPrefix,
  legend = "Locales",
}: {
  establishments: { id: string; name: string }[];
  allSelected: boolean;
  selected: readonly string[];
  idPrefix: string;
  legend?: string;
}) {
  return (
    <fieldset className="scope-fields">
      <legend>{legend}</legend>
      <label className="check">
        <input type="radio" name="scope" value="all" defaultChecked={allSelected} />
        Todos los locales (también los que se creen después)
      </label>
      <label className="check">
        <input type="radio" name="scope" value="some" defaultChecked={!allSelected} />
        Solo estos locales:
      </label>
      <div className="scope-list">
        {establishments.map((e) => (
          <label key={e.id} className="check" htmlFor={`${idPrefix}-${e.id}`}>
            <input
              id={`${idPrefix}-${e.id}`}
              type="checkbox"
              name="establishmentIds"
              value={e.id}
              defaultChecked={selected.includes(e.id)}
            />
            {e.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
