"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
}

/** Formulario que muestra los errores devueltos por una Server Action. */
export function ActionForm({ action, submitLabel, children, className = "form" }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const fieldErrors = Object.entries(state.fieldErrors ?? {});
  return (
    <form action={formAction} className={className} noValidate>
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
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Enviando…" : submitLabel}
      </button>
    </form>
  );
}
