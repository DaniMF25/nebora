/**
 * Planes de Nébora (D-046, D-062): nombre, precio y lo que añade cada uno.
 * Es la única fuente para la web pública, la página «Plan» del panel y la
 * prueba gratuita. Los precios son de ejemplo hasta que se fijen los
 * definitivos y se conecte un proveedor de cobros (no se cobra nada todavía).
 */
export type PlanId = "basic" | "advanced" | "pro";

/** Días de prueba gratuita del plan PRO al crear la organización. */
export const TRIAL_DAYS = 7;

export interface PlanInfo {
  id: PlanId;
  name: string;
  /** Precio mensual en euros, sin IVA (0 = gratis). */
  monthlyPrice: number;
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
    monthlyPrice: 0,
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
    monthlyPrice: 29,
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
    monthlyPrice: 59,
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

export function formatPrice(price: number): string {
  return price === 0 ? "Gratis" : `${price} €`;
}

/** Días completos o parciales que quedan de prueba (0 si terminó). */
export function trialDaysLeft(trialEndsAt: Date | null, now = new Date()): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000));
}
