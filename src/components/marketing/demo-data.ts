/**
 * Datos del restaurante de ejemplo de la web pública («La Lonja del Puerto»),
 * los mismos que scripts/marketing-screenshots.ts crea para las capturas. Las
 * demos de la portada calculan con ellos: no hay datos aleatorios.
 */

export interface DemoTable {
  name: string;
  seats: number;
  shape: "square" | "round" | "rect";
  zone: "Salón" | "Terraza";
  /** Posición y tamaño en la cuadrícula de su zona. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEMO_TABLES: DemoTable[] = [
  { name: "S1", seats: 2, shape: "square", zone: "Salón", x: 1, y: 1, w: 2, h: 2 },
  { name: "S2", seats: 2, shape: "square", zone: "Salón", x: 4, y: 1, w: 2, h: 2 },
  { name: "S3", seats: 4, shape: "round", zone: "Salón", x: 8, y: 1, w: 2, h: 2 },
  { name: "S4", seats: 4, shape: "round", zone: "Salón", x: 12, y: 1, w: 2, h: 2 },
  { name: "S5", seats: 8, shape: "rect", zone: "Salón", x: 1, y: 5, w: 5, h: 2 },
  { name: "S6", seats: 4, shape: "square", zone: "Salón", x: 8, y: 5, w: 2, h: 2 },
  { name: "B1", seats: 2, shape: "round", zone: "Salón", x: 12, y: 5, w: 2, h: 2 },
  { name: "T1", seats: 4, shape: "round", zone: "Terraza", x: 1, y: 1, w: 2, h: 2 },
  { name: "T2", seats: 4, shape: "round", zone: "Terraza", x: 5, y: 1, w: 2, h: 2 },
  { name: "T3", seats: 2, shape: "square", zone: "Terraza", x: 9, y: 1, w: 2, h: 2 },
  { name: "T4", seats: 2, shape: "square", zone: "Terraza", x: 12, y: 1, w: 2, h: 2 },
];

export interface DemoBooking {
  /** Minutos desde medianoche. */
  start: number;
  party: number;
  name: string;
  table: string;
}

const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export const DEMO_DURATION = 105;
export const DEMO_BOOKINGS: DemoBooking[] = [
  { start: t("13:30"), party: 2, name: "Elena Ferrer", table: "S1" },
  { start: t("14:00"), party: 4, name: "Familia Soler", table: "S3" },
  { start: t("14:15"), party: 6, name: "Comida de empresa", table: "S5" },
  { start: t("14:30"), party: 2, name: "Jordi Martí", table: "S2" },
  { start: t("20:30"), party: 2, name: "Marta y Joan", table: "T3" },
  { start: t("21:00"), party: 4, name: "Lucía Romero", table: "T1" },
  { start: t("21:00"), party: 4, name: "Grupo Iborra", table: "S4" },
  { start: t("21:30"), party: 2, name: "Pablo y Ana", table: "T4" },
  { start: t("22:00"), party: 3, name: "Hugo Navarro", table: "S6" },
];
/** Servicios del restaurante: el control de hora solo recorre las horas abiertas. */
export const DEMO_SERVICES = [
  { label: "Comidas", from: t("13:00"), to: t("16:30") },
  { label: "Cenas", from: t("20:00"), to: t("23:30") },
];

/** Receta de las croquetas (por ración) con el coste de referencia de cada ingrediente. */
export interface DemoLine {
  name: string;
  qty: number;
  unit: "ml" | "g" | "ud";
  /** € por litro, kilo o unidad. */
  costPerRef: number;
}
export const DEMO_RECIPE: DemoLine[] = [
  { name: "Jamón ibérico", qty: 45, unit: "g", costPerRef: 48 },
  { name: "Leche entera", qty: 250, unit: "ml", costPerRef: 1.05 },
  { name: "Huevos camperos", qty: 1, unit: "ud", costPerRef: 0.32 },
  { name: "Aceite de oliva virgen extra", qty: 30, unit: "ml", costPerRef: 7.2 },
  { name: "Harina de trigo", qty: 60, unit: "g", costPerRef: 0.9 },
];
export const DEMO_PRICE = 9.5;

/** Coste de una línea, como lo calcula el panel: cantidad × €/ref ÷ 1000 (salvo unidades). */
export function lineCost(l: DemoLine, costPerRef = l.costPerRef): number {
  return (l.qty * costPerRef) / (l.unit === "ud" ? 1 : 1000);
}

/** Carta con traducciones (como la pestaña «Traducciones» de cada carta). */
export const DEMO_LANGS = ["es", "en", "fr", "de"] as const;
export type DemoLang = (typeof DEMO_LANGS)[number];
export const DEMO_LANG_LABELS: Record<DemoLang, string> = { es: "Español", en: "English", fr: "Français", de: "Deutsch" };

type Tr = Record<DemoLang, string>;
export const DEMO_MENU: { section: Tr; dishes: { name: Tr; note: Tr; price: string; allergens: Tr }[] }[] = [
  {
    section: { es: "Para empezar", en: "Starters", fr: "Entrées", de: "Vorspeisen" },
    dishes: [
      {
        name: { es: "Croquetas de jamón ibérico", en: "Iberian ham croquettes", fr: "Croquettes au jambon ibérique", de: "Kroketten mit Iberico-Schinken" },
        note: { es: "Seis unidades", en: "Six pieces", fr: "Six pièces", de: "Sechs Stück" },
        price: "9,50 €",
        allergens: { es: "Gluten · Huevos · Lácteos", en: "Gluten · Eggs · Milk", fr: "Gluten · Œufs · Lait", de: "Gluten · Eier · Milch" },
      },
      {
        name: { es: "Gamba roja a la plancha", en: "Grilled red prawns", fr: "Crevettes rouges à la plancha", de: "Rote Garnelen vom Grill" },
        note: { es: "De la lonja de Dénia", en: "From the Dénia fish market", fr: "De la criée de Dénia", de: "Vom Fischmarkt in Dénia" },
        price: "19,00 €",
        allergens: { es: "Crustáceos", en: "Crustaceans", fr: "Crustacés", de: "Krebstiere" },
      },
    ],
  },
  {
    section: { es: "Arroces", en: "Rice dishes", fr: "Riz", de: "Reisgerichte" },
    dishes: [
      {
        name: { es: "Arroz del senyoret", en: "Senyoret rice", fr: "Riz senyoret", de: "Senyoret-Reis" },
        note: { es: "Mínimo dos personas", en: "For two or more", fr: "Deux personnes minimum", de: "Ab zwei Personen" },
        price: "18,50 €",
        allergens: { es: "Crustáceos · Moluscos · Pescado", en: "Crustaceans · Molluscs · Fish", fr: "Crustacés · Mollusques · Poisson", de: "Krebstiere · Weichtiere · Fisch" },
      },
      {
        name: { es: "Arroz negro con alioli", en: "Black rice with aioli", fr: "Riz noir à l’aïoli", de: "Schwarzer Reis mit Aioli" },
        note: { es: "Con sepia y su tinta", en: "With cuttlefish and its ink", fr: "À la seiche et son encre", de: "Mit Sepia und Tinte" },
        price: "17,00 €",
        allergens: { es: "Moluscos · Huevos", en: "Molluscs · Eggs", fr: "Mollusques · Œufs", de: "Weichtiere · Eier" },
      },
    ],
  },
];
