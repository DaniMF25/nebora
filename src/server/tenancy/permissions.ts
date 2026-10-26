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
  ],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
