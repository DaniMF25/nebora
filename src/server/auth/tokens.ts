import { createHash, randomBytes } from "node:crypto";

/** Token de sesión opaco: 256 bits aleatorios codificados en base64url. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Solo se almacena el SHA-256 del token; una fuga de la BD no permite suplantar sesiones. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
