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
  // Cabecera con la IP real del cliente que pone el proxy de la plataforma y que
  // el cliente no puede falsear (p. ej. `fly-client-ip` en Fly.io). Si se define,
  // es la única fuente de la IP para los límites de peticiones.
  // Inicio de sesión con proveedores externos (D-061). Cada uno se activa solo
  // si están todas sus variables (y APP_BASE_URL, para la dirección de vuelta).
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  FACEBOOK_APP_ID: z.string().regex(/^\d{5,32}$/, { message: "FACEBOOK_APP_ID debe ser numérico" }).optional(),
  FACEBOOK_APP_SECRET: z.string().min(1).optional(),
  // Versión de la Graph API (caducan a los dos años); por defecto, una vigente.
  FACEBOOK_GRAPH_VERSION: z.string().regex(/^v\d{1,2}\.\d$/).default("v23.0"),
  APPLE_CLIENT_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/, { message: "APPLE_TEAM_ID tiene 10 caracteres" }).optional(),
  APPLE_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/, { message: "APPLE_KEY_ID tiene 10 caracteres" }).optional(),
  // Clave privada .p8 (PEM). Admite saltos de línea escritos como \n.
  APPLE_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((v) => v.replace(/\\n/g, "\n"))
    .optional(),
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/i, { message: "CLIENT_IP_HEADER debe ser un nombre de cabecera" })
    .transform((v) => v.toLowerCase())
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
