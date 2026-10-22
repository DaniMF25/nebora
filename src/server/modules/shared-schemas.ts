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
