/**
 * Identificador para la URL a partir de un nombre: sin tildes, en minúsculas,
 * con guiones y de 3 a 50 caracteres («Casa Pepé & Hijos» → «casa-pepe-hijos»).
 * Devuelve "" si el nombre no da para un identificador válido.
 */
export function slugify(name: string, maxLength = 50): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}
