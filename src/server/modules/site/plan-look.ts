import "server-only";
import { getPool } from "@/server/db/pool";
import { isPlan, planIncludes, type Plan } from "@/server/tenancy/permissions";
import { isUuid } from "@/server/validation";

// Aspecto de la web según el plan (D-047): en Básico, estilo Clásico sin
// color ni tipografía propios y sin galería. Lo guardado no se borra: vuelve
// a verse al subir de plan.

export const BASIC_SITE_THEME = "clasico" as const;

/** ¿Permite el plan elegir estilo, color, tipografía y galería? */
export function planAllowsCustomLook(plan: Plan): boolean {
  return planIncludes(plan, "advanced");
}

/** Aspecto efectivo: el guardado, o el del plan Básico. */
export function effectiveLook<T extends { theme: string; accentColor: string | null; fontPairing: string | null }>(
  value: T,
  plan: Plan,
): T {
  return planAllowsCustomLook(plan) ? value : { ...value, theme: BASIC_SITE_THEME, accentColor: null, fontPairing: null };
}

/** Plan de la organización de un local, para las páginas públicas (sin sesión). */
export async function publicEstablishmentPlan(establishmentId: string): Promise<Plan> {
  if (!isUuid(establishmentId)) return "basic";
  const { rows } = await getPool().query<{ plan: string | null }>(
    "SELECT app.public_establishment_plan($1) AS plan",
    [establishmentId],
  );
  const plan = rows[0]?.plan;
  // Sin plan conocido, el aspecto más restrictivo.
  return isPlan(plan) ? plan : "basic";
}
