import "server-only";
import { z } from "zod";

function isOriginOnlyUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && u.pathname === "/" && !u.search && !u.hash && !u.username;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL es obligatoria")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL debe ser una URL de PostgreSQL",
    }),
  // El registro público está desactivado salvo que se habilite explícitamente.
  AUTH_ALLOW_SIGNUP: z.enum(["true", "false"]).default("false"),
  // Origen público de la aplicación (p. ej. https://app.ejemplo.com). Opcional:
  // sin él, las funciones que generan enlaces absolutos (QR) quedan desactivadas.
  APP_BASE_URL: z
    .string()
    .refine(isOriginOnlyUrl, { message: "APP_BASE_URL debe ser un origen http(s), sin ruta" })
    .transform((v) => new URL(v).origin)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida una fuente de configuración. Los errores nombran variables, nunca valores. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuración del servidor inválida: ${fields}`);
  }
  const base = parsed.data.APP_BASE_URL ? new URL(parsed.data.APP_BASE_URL) : null;
  const loopback = base !== null && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (parsed.data.NODE_ENV === "production" && base?.protocol === "http:" && !loopback) {
    throw new Error("Configuración del servidor inválida: APP_BASE_URL debe usar https en producción");
  }
  return parsed.data;
}

/** Configuración del proceso; falla de forma segura si falta algo. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
