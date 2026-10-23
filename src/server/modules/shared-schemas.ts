import { z } from "zod";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, {
    message: "Usa de 3 a 63 caracteres: minúsculas, números y guiones (sin guion al inicio o final)",
  });

export const nameSchema = z.string().trim().min(1, "El nombre es obligatorio").max(120);

const supportedTimezones = new Set(Intl.supportedValuesOf("timeZone"));

export const timezoneSchema = z.string().refine((tz) => supportedTimezones.has(tz), {
  message: "Zona horaria no válida",
});

/**
 * La web pública del local vive en /<organización>/<local>, así que una
 * organización no puede usar el nombre de una ruta de la aplicación. La misma
 * lista está en la restricción organizations_slug_not_reserved (migración 0013).
 */
export const RESERVED_ORGANIZATION_SLUGS = [
  "app", "api", "login", "register", "invite", "logout", "m", "q", "r", "media", "static",
  "public", "admin", "assets", "favicon", "robots", "sitemap", "nebora",
] as const;

export const organizationSlugSchema = slugSchema.refine(
  (s) => !(RESERVED_ORGANIZATION_SLUGS as readonly string[]).includes(s),
  { message: "Ese identificador está reservado" },
);
