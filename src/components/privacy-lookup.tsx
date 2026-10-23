"use client";

import { useActionState, useState, useTransition } from "react";
import type { LookupState } from "@/lib/privacy-lookup";

interface Props {
  searchAction: (state: LookupState, formData: FormData) => Promise<LookupState>;
  eraseAction: (contact: string) => Promise<LookupState>;
  exportUrl: string;
}

/** Búsqueda de datos de un cliente con exportación y borrado. */
export function PrivacyLookup({ searchAction, eraseAction, exportUrl }: Props) {
  const [searchState, formAction, searching] = useActionState(searchAction, {} as LookupState);
  const [eraseState, setEraseState] = useState<LookupState | null>(null);
  const [erasing, startErase] = useTransition();
  // El resultado del borrado sustituye al de la búsqueda hasta la siguiente búsqueda.
  const state = eraseState && eraseState.contact === searchState.contact ? eraseState : searchState;
  const results = state.results ?? [];

  function erase() {
    const contact = searchState.contact;
    if (!contact) return;
    if (!window.confirm(`¿Borrar los datos personales asociados a ${contact}? No se puede deshacer.`)) return;
    startErase(async () => setEraseState(await eraseAction(contact)));
  }

  return (
    <div className="form">
      <form action={(fd) => { setEraseState(null); formAction(fd); }} className="inline-form" noValidate>
        <label>
          Correo o teléfono del cliente
          <input name="contact" required maxLength={254} autoComplete="off" defaultValue={searchState.contact} />
        </label>
        <button type="submit" disabled={searching}>
          {searching ? "Buscando…" : "Buscar"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      {state.message && <p role="status">{state.message}</p>}
      {state.contact && !state.error && results.length === 0 && !state.message && (
        <p className="muted">No hay datos asociados a ese contacto.</p>
      )}
      {results.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Local</th>
                  <th>Nombre</th>
                  <th>Contacto</th>
                  <th>Pers.</th>
                  <th>Estado</th>
                  <th>Canal</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.when}</td>
                    <td>{r.establishment}</td>
                    <td>{r.name}</td>
                    <td>{[r.phone, r.email].filter(Boolean).join(" · ")}</td>
                    <td>{r.partySize}</td>
                    <td>{r.status}</td>
                    <td>{r.channel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline-form">
            <form method="post" action={exportUrl}>
              <input type="hidden" name="contact" value={searchState.contact} />
              <button type="submit">Descargar datos (JSON)</button>
            </form>
            <button type="button" onClick={erase} disabled={erasing}>
              {erasing ? "Borrando…" : "Borrar datos del cliente"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
