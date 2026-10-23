import "server-only";
import { ValidationError } from "@/server/errors";
import { MAX_UPLOAD_BYTES } from "@/server/modules/media/service";

/**
 * Lee el campo de imagen de un formulario. Comprueba el tamaño declarado antes
 * de cargarlo; el formato y el contenido los valida el servicio de imágenes.
 */
export async function readImageField(fd: FormData, field = "image"): Promise<Uint8Array> {
  const file = fd.get(field);
  if (!(file instanceof File) || file.size === 0) return new Uint8Array();
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ValidationError("La imagen supera 8 MB", { [field]: ["La imagen supera 8 MB"] });
  }
  return new Uint8Array(await file.arrayBuffer());
}
