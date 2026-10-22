import "server-only";
import type { FormState } from "@/lib/form-state";
import { AppError, ValidationError } from "@/server/errors";

/** Convierte errores en un estado seguro para la interfaz; nunca expone detalles internos. */
export function toFormState(err: unknown): FormState {
  if (err instanceof ValidationError) return { error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof AppError) return { error: err.message };
  console.error("[action] error inesperado", { name: (err as Error)?.name });
  return { error: "Se ha producido un error inesperado" };
}

/** Extrae solo los campos esperados del formulario (lista blanca). */
export function formToObject(formData: FormData, fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = formData.get(f);
    if (typeof v === "string") out[f] = v;
  }
  return out;
}
