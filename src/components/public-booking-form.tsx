"use client";

import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  /** Textos del botón y de la confirmación en el idioma de la página (D-040). */
  texts: { submit: string; sending: string; another: string };
  /** Enlace para hacer otra reserva (conserva el idioma). */
  anotherHref: string;
}

/**
 * Formulario de reserva online: al confirmarse se sustituye por la confirmación.
 * Con JavaScript se envía a mano para que un error del servidor no vacíe lo
 * escrito (React restablece el formulario tras un envío nativo); sin
 * JavaScript sigue funcionando con el envío nativo.
 */
export function PublicBookingForm({ action, children, texts, anotherHref }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }
  if (state.ok) {
    return (
      <div role="status" className="notice confirmation">
        <p>{state.message}</p>
        <p>
          <a href={anotherHref}>{texts.another}</a>
        </p>
      </div>
    );
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="form" noValidate>
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
        {pending ? texts.sending : texts.submit}
      </button>
    </form>
  );
}
