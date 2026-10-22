import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Correo electrónico no válido" }));

export const registerSchema = z
  .object({
    email: emailSchema,
    displayName: z.string().trim().min(1, "Indica tu nombre").max(120),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
      .max(PASSWORD_MAX_LENGTH, `La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres`),
  })
  .strict()
  .refine((v) => v.password.toLowerCase() !== v.email, {
    message: "La contraseña no puede ser igual al correo",
    path: ["password"],
  });

export const loginSchema = z
  .object({
    email: emailSchema,
    // En el login no se aplica la política de longitud mínima (solo el máximo),
    // para no revelar información sobre la política a un atacante.
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
