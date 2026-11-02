/**
 * Matriz de permisos por rol de organización. Solo incluye permisos de
 * funciones implementadas; se amplía a medida que se añaden módulos.
 * El servidor es la única fuente de verdad: el rol se lee de la base de datos,
 * nunca de la petición del cliente.
 */
export const ROLES = ["owner", "admin", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "organization.read",
  "organization.update",
  "members.read",
  "members.manage",
  "establishments.read",
  "establishments.create",
  "establishments.update",
  "audit.read",
  "menus.read",
  "menus.edit",
  "menus.publish",
  "inventory.read",
  "inventory.move",
  "inventory.manage",
  "costs.read",
  "purchasing.read",
  "purchasing.manage",
  "purchasing.receive",
  "tables.read",
  "tables.manage",
  "reservations.read",
  "reservations.manage",
  // Datos personales de clientes (retención, exportación y borrado): solo owner/admin.
  "privacy.manage",
  // Visitas a la web, cartas y QR, y resumen de reservas.
  "stats.read",
  // Catálogo común a todos los locales: productos, recetas, ingredientes y
  // proveedores. Solo con acceso a todos los locales (D-031).
  "catalog.manage",
  // Personal y cuadrante de turnos (D-045): todos lo ven; lo editan los encargados.
  "staff.read",
  "staff.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: [
    "organization.read",
    "members.read",
    "establishments.read",
    "establishments.update",
    "menus.read",
    "menus.edit",
    "menus.publish",
    "inventory.read",
    "inventory.move",
    "inventory.manage",
    "costs.read",
    "purchasing.read",
    "purchasing.manage",
    "purchasing.receive",
    "tables.read",
    "tables.manage",
    "reservations.read",
    "reservations.manage",
    "stats.read",
    "catalog.manage",
    "staff.read",
    "staff.manage",
  ],
  // El personal registra consumos, mermas y recepciones de mercancía, pero no
  // corrige, no configura ni ve costes o precios de compra.
  staff: [
    "organization.read",
    "establishments.read",
    "menus.read",
    "inventory.read",
    "inventory.move",
    "purchasing.read",
    "purchasing.receive",
    "tables.read",
    // El personal de sala toma y gestiona reservas.
    "reservations.read",
    "reservations.manage",
    // Consulta el cuadrante de turnos de sus locales.
    "staff.read",
  ],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Permisos que exigen acceso a todos los locales (afectan a toda la organización). */
export const ORG_WIDE_PERMISSIONS: readonly Permission[] = ["catalog.manage"];

/** Planes de la organización (D-046), de menos a más. */
export const PLANS = ["basic", "advanced", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

/**
 * Plan mínimo de cada permiso. Lo que no aparece está en todos los planes
 * (Básico: web, cartas con sus platos, estadísticas y privacidad).
 */
const PERMISSION_PLAN: Partial<Record<Permission, Plan>> = {
  // Avanzado: reservas, sala, miembros, personal y turnos.
  "members.read": "advanced",
  "members.manage": "advanced",
  "tables.read": "advanced",
  "tables.manage": "advanced",
  "reservations.read": "advanced",
  "reservations.manage": "advanced",
  "staff.read": "advanced",
  "staff.manage": "advanced",
  // PRO: gestión (costes y recetas, inventario, proveedores y compras).
  "costs.read": "pro",
  "inventory.read": "pro",
  "inventory.move": "pro",
  "inventory.manage": "pro",
  "purchasing.read": "pro",
  "purchasing.manage": "pro",
  "purchasing.receive": "pro",
};

/** ¿Incluye `plan` lo que exige `required`? */
export function planIncludes(plan: Plan, required: Plan): boolean {
  return PLANS.indexOf(plan) >= PLANS.indexOf(required);
}

/**
 * Permisos efectivos de una membresía: los de su rol que incluye el plan de
 * la organización. Quien solo accede a algunos locales pierde además los
 * permisos que afectan a toda la organización.
 */
export function permissionsFor(role: Role, allEstablishments = true, plan: Plan = "pro"): ReadonlySet<Permission> {
  return new Set(
    ROLE_PERMISSIONS[role].filter(
      (p) =>
        (allEstablishments || !ORG_WIDE_PERMISSIONS.includes(p)) && planIncludes(plan, PERMISSION_PLAN[p] ?? "basic"),
    ),
  );
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
