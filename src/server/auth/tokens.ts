import { createHash, randomBytes } from "node:crypto";

/** Token opaco: 256 bits aleatorios codificados en base64url (43 caracteres). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Solo se almacena el SHA-256 del token; una fuga de la BD no permite usarlo. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

// Alias para sesiones (mismo formato).
export const generateSessionToken = generateToken;
export const hashSessionToken = hashToken;
export const SESSION_TOKEN_PATTERN = TOKEN_PATTERN;
