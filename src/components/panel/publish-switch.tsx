"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form-state";

/**
 * Interruptor para publicar o retirar la web. Envía el estado contrario al
 * actual; el servidor valida (p. ej. que haya titular) y responde con el error.
 */
export function PublishSwitch({
  published,
  action,
  disabled = false,
}: {
  published: boolean;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="publish-switch">
      <input type="hidden" name="published" value={published ? "0" : "1"} readOnly />
      <button
        type="submit"
        role="switch"
        aria-checked={published}
        aria-label="Publicar la web"
        disabled={disabled || pending}
        className="switch-button"
      >
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span>{pending ? "Guardando…" : published ? "Web publicada" : "Web sin publicar"}</span>
      </button>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
