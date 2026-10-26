"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form-state";
import { EstablishmentScopeFields } from "./establishment-scope-fields";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  establishments: { id: string; name: string }[];
}

/**
 * Formulario de invitación. El enlace solo se muestra en la respuesta a quien
 * invita: no hay proveedor de correo configurado, así que debe entregarlo él.
 */
export function InviteForm({ action, establishments }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  // Solo hay enlace tras la respuesta de la acción, ya en el cliente.
  const link = state.invitePath && typeof window !== "undefined" ? `${window.location.origin}${state.invitePath}` : "";

  return (
    <form action={formAction} className="form" noValidate>
      <label>
        Correo electrónico
        <input name="email" type="email" required autoComplete="off" />
      </label>
      <label>
        Rol
        <select name="role" defaultValue="staff">
          <option value="staff">Personal</option>
          <option value="manager">Encargado</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      {establishments.length > 0 && (
        <EstablishmentScopeFields
          establishments={establishments}
          allSelected
          selected={[]}
          idPrefix="invite"
          legend="Locales a los que accede (encargados y personal)"
        />
      )}
      {state.error && (
        <div role="alert" className="alert">
          {state.error}
        </div>
      )}
      {link && (
        <div role="status" className="notice">
          <p>
            Invitación creada. Copia este enlace y envíaselo a la persona invitada; no se volverá a mostrar y
            caduca en 7 días:
          </p>
          <input readOnly value={link} aria-label="Enlace de invitación" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Crear invitación"}
      </button>
    </form>
  );
}
