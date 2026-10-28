"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

interface Props {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Nombre accesible del botón si el texto visible se abrevia (p. ej. «Sentar» → «Sentar (Marta)»). */
  submitAriaLabel?: string;
  children?: ReactNode;
  className?: string;
  /** Limpiar el formulario al ir bien (por defecto). No en editores que muestran lo guardado. */
  resetOnSuccess?: boolean;
  /**
   * Segunda acción sin campos propios (p. ej. «Eliminar»), con su botón junto
   * al principal. Con JavaScript se envía sin los campos del formulario.
   */
  secondary?: { action: (state: FormState, formData: FormData) => Promise<FormState>; label: string };
}

async function noSecondary(state: FormState): Promise<FormState> {
  return state;
}

/**
 * Formulario que muestra los errores devueltos por una Server Action.
 *
 * React restablece el formulario tras cualquier envío, también cuando el
 * servidor lo rechaza, y el usuario perdería lo escrito. Con JavaScript se
 * envía a mano (sin ese restablecimiento) y solo se limpia si la acción va
 * bien. Sin JavaScript sigue funcionando con el envío nativo.
 */
export function ActionForm({
  action,
  submitLabel,
  submitAriaLabel,
  children,
  className = "form",
  resetOnSuccess = true,
  secondary,
}: Props) {
  const [mainState, formAction, mainPending] = useActionState(action, {} as FormState);
  const [secondaryState, secondaryAction, secondaryPending] = useActionState(
    secondary?.action ?? noSecondary,
    {} as FormState,
  );
  const [last, setLast] = useState<"main" | "secondary">("main");
  const state = last === "main" ? mainState : secondaryState;
  const pending = mainPending || secondaryPending;
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = Object.entries(state.fieldErrors ?? {});

  useEffect(() => {
    if (mainState.ok && resetOnSuccess) formRef.current?.reset();
  }, [mainState, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (secondary && submitter?.dataset.secondary !== undefined) {
      setLast("secondary");
      startTransition(() => secondaryAction(new FormData()));
      return;
    }
    const data = new FormData(event.currentTarget);
    setLast("main");
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
      {secondary ? (
        <div className="form-actions">
          <button type="submit" disabled={pending}>
            {mainPending ? "Enviando…" : submitLabel}
          </button>
          <button type="submit" className="secondary" formAction={secondaryAction} data-secondary="" disabled={pending}>
            {secondaryPending ? "Enviando…" : secondary.label}
          </button>
        </div>
      ) : (
        <button type="submit" disabled={pending} aria-label={submitAriaLabel}>
          {pending ? "Enviando…" : submitLabel}
        </button>
      )}
    </form>
  );
}
