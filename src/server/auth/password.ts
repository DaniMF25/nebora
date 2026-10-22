import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hash de contraseñas con scrypt (primitiva de Node/OpenSSL; no es criptografía
 * propia). Parámetros según la recomendación OWASP: N=2^17, r=8, p=1.
 * Formato almacenado: scrypt$<logN>$<r>$<p>$<salt b64url>$<hash b64url>, lo que
 * permite endurecer parámetros más adelante y rehashear al iniciar sesión.
 */
const DEFAULT_PARAMS = { logN: 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const PASSWORD_MIN_LENGTH = 12;
// Límite superior para evitar abusos de CPU/memoria con entradas enormes.
export const PASSWORD_MAX_LENGTH = 256;

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN;
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string, params = DEFAULT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, params.logN, params.r, params.p);
  return [
    "scrypt",
    params.logN,
    params.r,
    params.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logNs, rs, ps, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const logN = Number(logNs);
  const r = Number(rs);
  const p = Number(ps);
  if (![logN, r, p].every(Number.isInteger) || logN < 14 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 4) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), logN, r, p);
  return timingSafeEqual(actual, expected);
}

/** Hash con el que comparar cuando el usuario no existe, para igualar tiempos. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
}
