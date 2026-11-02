import { z } from "zod";

// Esquema de precios compartido por productos, cartas y fuera de carta. En
// un archivo propio para que menus.ts no dependa de products.ts (products.ts
// vuelve a publicar las cartas, D-048, y la dependencia sería circular).

export const MAX_PRICE_CENTS = 100_000_000;
export const priceCentsSchema = z.number().int().min(0).max(MAX_PRICE_CENTS);
