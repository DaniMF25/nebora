import { randomBytes } from "node:crypto";
import { registerUser, type AuthUser } from "@/server/auth/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { withUser } from "@/server/tenancy/context";
import type { Plan, Role } from "@/server/tenancy/permissions";
import { withAdminClient } from "./db";

export const TEST_PASSWORD = "contraseña-de-prueba-larga";

export function uniqueSuffix(): string {
  return randomBytes(4).toString("hex");
}

export async function createTestUser(label = "user"): Promise<AuthUser> {
  return registerUser(
    { email: `${label}-${uniqueSuffix()}@example.test`, displayName: label, password: TEST_PASSWORD },
    { allowSignup: true },
  );
}

/**
 * Crea una organización. Las pruebas existentes cubren funciones de todos los
 * planes: por defecto queda en PRO, sin prueba gratuita en curso (una
 * organización nueva real empieza con la prueba del PRO, D-062; las pruebas de
 * planes y de la prueba lo indican expresamente).
 */
export async function createTestOrganization(owner: AuthUser, label = "org", plan: Plan = "pro"): Promise<string> {
  const id = await withUser(owner, (tx, ctx) =>
    createOrganization(tx, ctx, { name: `Restaurante ${label}`, slug: `${label}-${uniqueSuffix()}` }),
  );
  await withAdminClient((c) =>
    c.query("UPDATE organizations SET plan = $2, trial_ends_at = NULL, locked_at = NULL WHERE id = $1", [id, plan]),
  );
  return id;
}

/** Añade un miembro directamente (aún no hay flujo de invitaciones). */
export async function addMember(organizationId: string, user: AuthUser, role: Role): Promise<void> {
  await withAdminClient((c) =>
    c.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)", [
      organizationId,
      user.id,
      role,
    ]),
  );
}
