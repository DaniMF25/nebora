"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  /** Limpiar el formulario al ir bien (por defecto). No en editores que muestran lo guardado. */
  resetOnSuccess?: boolean;
}

/**
 * Formulario que muestra los errores devueltos por una Server Action.
 *
 * React restablece el formulario tras cualquier envío, también cuando el
 * servidor lo rechaza, y el usuario perdería lo escrito. Con JavaScript se
 * envía a mano (sin ese restablecimiento) y solo se limpia si la acción va
 * bien. Sin JavaScript sigue funcionando con el envío nativo.
 */
export function ActionForm({ action, submitLabel, children, className = "form", resetOnSuccess = true }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = Object.entries(state.fieldErrors ?? {});

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className={className} noValidate>
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
