"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
}

/** Formulario que muestra los errores devueltos por una Server Action. */
export function ActionForm({ action, submitLabel, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const fieldErrors = Object.entries(state.fieldErrors ?? {});
  return (
    <form action={formAction} className="form" noValidate>
      {children}
      {state.error && (
        <div role="alert" className="alert">
          <p>{state.error}</p>
          {fieldErrors.length > 0 && (
            <ul>
              {fieldErrors.map(([field, messages]) => (
                <li key={field}>
                  <strong>{field}</strong>: {messages.join(". ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Enviando…" : submitLabel}
      </button>
    </form>
  );
}
