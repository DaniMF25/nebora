import "server-only";
import { parseEuroAmount } from "@/lib/money";
import { formString } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";

// Lectura del formulario de plato (ProductFields), compartida por la ficha
// del plato, el catálogo (PRO) y el editor de cartas (D-046).

/** Formatos f<n>l / f<n>p (D-038); el servicio valida número y nombres. */
function readFormats(formData: FormData): { label: string; priceCents: number }[] {
  const formats = [];
  for (let n = 0; n < 20 && formData.has(`f${n}l`); n++) {
    const priceCents = parseEuroAmount(formString(formData, `f${n}p`));
    if (priceCents === null) throw new ValidationError(`Formato ${n + 1}: precio no válido (por ejemplo 12,50)`);
    formats.push({ label: formString(formData, `f${n}l`), priceCents });
  }
  return formats;
}

export function readProductForm(formData: FormData) {
  if (formData.get("formats") === "on") {
    const formats = readFormats(formData);
    const allergens = formData.getAll("allergens").filter((a): a is string => typeof a === "string");
    // El servicio fija como precio del producto el más bajo de los formatos.
    return {
      name: formString(formData, "name"),
      description: formString(formData, "description"),
      priceCents: 0,
      formats,
      allergens,
    };
  }
  const priceCents = parseEuroAmount(formString(formData, "price"));
  if (priceCents === null) throw new ValidationError("Precio no válido (por ejemplo 12,50)");
  const allergens = formData.getAll("allergens").filter((a): a is string => typeof a === "string");
  return {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    priceCents,
    formats: null,
    // Se envían tal cual: el esquema del servicio rechaza códigos desconocidos.
    allergens,
  };
}
