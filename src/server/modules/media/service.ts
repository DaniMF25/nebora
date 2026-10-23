import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { getPool, type Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { TenantContext } from "@/server/tenancy/context";
import { isUuid } from "@/server/validation";

/** Tamaño máximo del archivo subido (antes de reprocesar). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Lado mayor de la imagen guardada. */
export const MAX_IMAGE_SIDE = 1600;
/** Límite tras reprocesar (coincide con la restricción de la tabla). */
const MAX_STORED_BYTES = 1_500_000;
/** Cupo total por organización mientras las imágenes se guardan en la BD. */
export const ORGANIZATION_MEDIA_QUOTA_BYTES = 200 * 1024 * 1024;
/** Evita descomprimir imágenes gigantes (bombas de descompresión). */
const MAX_INPUT_PIXELS = 50_000_000;

export interface StoredImage {
  id: string;
  width: number;
  height: number;
}

type ImageKind = "jpeg" | "png" | "webp";

/** Reconoce el formato por su firma, no por la extensión ni el tipo declarado. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const invalid = (message: string) => new ValidationError(message, { image: [message] });

/**
 * Valida y reprocesa la imagen: solo JPEG/PNG/WebP reconocidos por su firma,
 * orientación aplicada, reducida a MAX_IMAGE_SIDE y recodificada a WebP sin
 * metadatos (se eliminan EXIF/GPS). Nunca se guarda el archivo original.
 */
export async function processImage(bytes: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  if (bytes.length === 0) throw invalid("Selecciona una imagen");
  if (bytes.length > MAX_UPLOAD_BYTES) throw invalid("La imagen supera 8 MB");
  if (!sniffImage(bytes)) throw invalid("Formato no admitido: usa JPEG, PNG o WebP");
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > MAX_STORED_BYTES) throw invalid("La imagen es demasiado pesada incluso tras comprimirla");
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw invalid("No se ha podido leer la imagen");
  }
}

/**
 * Guarda una imagen ya autorizada por el llamador (que comprueba el permiso
 * del recurso al que se asocia). Respeta el cupo de la organización.
 */
export async function storeImage(tx: Tx, ctx: TenantContext, bytes: Uint8Array): Promise<StoredImage> {
  const img = await processImage(bytes);
  // Serializa las subidas de la organización para que el cupo no se supere en paralelo.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('media:' || $1::text, 0))", [ctx.organizationId]);
  const used = await tx.query<{ total: string }>(
    "SELECT COALESCE(sum(byte_size), 0)::text AS total FROM media_assets WHERE organization_id = $1",
    [ctx.organizationId],
  );
  if (BigInt(used.rows[0]!.total) + BigInt(img.data.length) > BigInt(ORGANIZATION_MEDIA_QUOTA_BYTES)) {
    throw invalid("Se ha alcanzado el espacio de imágenes de la organización");
  }
  const sha256 = createHash("sha256").update(img.data).digest("hex");
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO media_assets (organization_id, content_type, width, height, byte_size, sha256, data, created_by_user_id)
     VALUES ($1, 'image/webp', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ctx.organizationId, img.width, img.height, img.data.length, sha256, img.data, ctx.userId],
  );
  return { id: rows[0]!.id, width: img.width, height: img.height };
}

export interface MediaFile {
  contentType: string;
  data: Buffer;
  etag: string;
}

/** Imagen de la organización para el panel (cualquier miembro activo). */
export async function getOrganizationMedia(tx: Tx, ctx: TenantContext, id: string): Promise<MediaFile> {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<{ content_type: string; data: Buffer; sha256: string }>(
    "SELECT content_type, data, sha256 FROM media_assets WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, id],
  );
  const r = rows[0];
  if (!r) throw new NotFoundError();
  return { contentType: r.content_type, data: r.data, etag: `"${r.sha256}"` };
}

/**
 * Imagen pública: solo si la usa un perfil publicado o una carta publicada
 * (lo decide app.public_media). Devuelve null en cualquier otro caso.
 */
export async function getPublicMedia(id: string): Promise<MediaFile | null> {
  if (!isUuid(id)) return null;
  const { rows } = await getPool().query<{ content_type: string; data: Buffer; sha256: string }>(
    "SELECT * FROM app.public_media($1)",
    [id],
  );
  const r = rows[0];
  return r ? { contentType: r.content_type, data: r.data, etag: `"${r.sha256}"` } : null;
}
