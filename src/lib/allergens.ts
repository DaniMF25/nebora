/** Alérgenos de declaración obligatoria en la UE (Reglamento 1169/2011, anexo II). */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: "Gluten",
  crustaceans: "Crustáceos",
  eggs: "Huevos",
  fish: "Pescado",
  peanuts: "Cacahuetes",
  soybeans: "Soja",
  milk: "Lácteos",
  nuts: "Frutos de cáscara",
  celery: "Apio",
  mustard: "Mostaza",
  sesame: "Sésamo",
  sulphites: "Sulfitos",
  lupin: "Altramuces",
  molluscs: "Moluscos",
};
