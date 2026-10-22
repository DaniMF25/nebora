import "server-only";
import { z } from "zod";

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
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida la configuración del servidor y falla de forma segura si falta algo. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Solo se informa del nombre de las variables, nunca de sus valores.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuración del servidor inválida: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}
