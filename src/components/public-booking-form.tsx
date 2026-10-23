"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
}

/** Formulario de reserva online: al confirmarse se sustituye por la confirmación. */
export function PublicBookingForm({ action, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  if (state.ok) {
    return (
      <div role="status" className="notice confirmation">
        <p>{state.message}</p>
        <p>
          <a href="?">Hacer otra reserva</a>
        </p>
      </div>
    );
  }
  return (
    <form action={formAction} className="form" noValidate>
      {children}
      {state.error && (
        <div role="alert" className="alert">
          <p>{state.error}</p>
          {state.fieldErrors && Object.values(state.fieldErrors).flat().length > 0 && (
            <ul>
              {Object.values(state.fieldErrors)
                .flat()
                .map((m) => (
                  <li key={m}>{m}</li>
                ))}
            </ul>
          )}
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Reservar"}
      </button>
    </form>
  );
}
