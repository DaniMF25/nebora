/**
 * Planes de Nébora (D-046, D-062): nombre, precio y lo que añade cada uno.
 * Es la única fuente para la web pública, la página «Plan» del panel y la
 * prueba gratuita. Precios fijados por el titular (D-067); aún no hay
 * proveedor de cobros conectado, así que no se cobra nada todavía.
 */
export type PlanId = "basic" | "advanced" | "pro";

/** Días de prueba gratuita del plan PRO al crear la organización. */
export const TRIAL_DAYS = 7;

/**
 * Días que la web y la carta siguen visibles tras bloquearse la organización
 * sin plan; después se borra (D-068). Debe coincidir con la migración 0040.
 */
export const LOCK_GRACE_DAYS = 15;

export interface PlanInfo {
  id: PlanId;
  name: string;
  /** Precio mensual en euros, sin IVA. */
  monthlyPrice: number;
  /** El plan que se destaca en la web (el que más compensa). */
  recommended?: boolean;
  /** Frase de venta junto al precio. */
  pitch: string;
  summary: string;
  /** Para quién es, en la web pública. */
  audience: string;
  /** Lo que añade al plan anterior. */
  features: string[];
}

export const PLAN_INFO: PlanInfo[] = [
  {
    id: "basic",
    name: "Básico",
    monthlyPrice: 14.99,
    pitch: "Tu carta con QR y tu web, listas esta tarde.",
    summary: "Para tener web y carta en poco tiempo.",
    audience: "Bares y locales que quieren estar en internet sin complicarse.",
    features: [
      "Web pública del restaurante con horario y datos de contacto",
      "Cartas digitales con QR, traducciones y precios por formato",
      "Estadísticas de visitas",
      "Privacidad y datos de clientes",
      "Una sola persona en el panel",
    ],
  },
  {
    id: "advanced",
    name: "Avanzado",
    monthlyPrice: 24.99,
    pitch: "La sala y el equipo, sin libretas ni grupos de WhatsApp.",
    summary: "Todo lo del Básico, más la operativa de sala.",
    audience: "Restaurantes con reservas y un equipo que organizar.",
    features: [
      "Reservas online y en el panel, con lista de espera",
      "Plano de sala con mesas",
      "Miembros del equipo con roles y acceso por local",
      "Personal y cuadrante de turnos",
      "Web con estilo, color y tipografía propios, galería de fotos e historias",
      "Formulario de contacto con bandeja de mensajes",
      "Exportaciones a Excel (CSV)",
    ],
  },
  {
    id: "pro",
    name: "PRO",
    monthlyPrice: 34.99,
    recommended: true,
    pitch: "Por 10 € más que el Avanzado, toda la gestión de cocina.",
    summary: "Todo lo del Avanzado, más la gestión de cocina.",
    audience: "Negocios que quieren controlar costes, stock y compras.",
    features: [
      "Catálogo de productos con recetas, escandallos y costes",
      "Inventario: ingredientes, almacenes, movimientos y recuentos",
      "Proveedores y pedidos de compra",
    ],
  },
];

export function planInfo(id: PlanId): PlanInfo {
  return PLAN_INFO.find((p) => p.id === id)!;
}

const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** «14,99 €». */
export function formatPrice(price: number): string {
  return EUR.format(price);
}

/** Lo que sale al día un precio mensual (12 meses entre 365 días), redondeado al céntimo: «0,49 €». */
export function formatDailyPrice(monthly: number): string {
  return EUR.format(Math.round(((monthly * 12) / 365) * 100) / 100);
}

/** Días completos o parciales que quedan de prueba (0 si terminó). */
export function trialDaysLeft(trialEndsAt: Date | null, now = new Date()): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000));
}
