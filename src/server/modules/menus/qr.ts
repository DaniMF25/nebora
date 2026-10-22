import "server-only";
import QRCode from "qrcode";

export const PUBLIC_CODE_PATTERN = /^[0-9a-f]{12}$/;

/** Enlace corto permanente de una carta (el que codifica el QR). */
export function menuShortUrl(baseUrl: string, publicCode: string): string {
  if (!PUBLIC_CODE_PATTERN.test(publicCode)) throw new Error("Código público no válido");
  return new URL(`/q/${publicCode}`, baseUrl).toString();
}

// Corrección de errores "M" (~15 %): tolera suciedad o desgaste en papel.
const OPTIONS = { errorCorrectionLevel: "M", margin: 2 } as const;

export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: "svg" });
}

export function renderQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...OPTIONS, type: "png", width: 1024 });
}
