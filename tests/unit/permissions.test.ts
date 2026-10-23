import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, isRole, permissionsFor, roleHasPermission } from "@/server/tenancy/permissions";

describe("matriz de permisos", () => {
  it("owner y admin tienen todos los permisos definidos", () => {
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("owner", p)).toBe(true);
      expect(roleHasPermission("admin", p)).toBe(true);
    }
  });

  it("staff solo lee, salvo movimientos, recepciones y reservas", () => {
    expect([...permissionsFor("staff")].sort()).toEqual([
      "establishments.read",
      "inventory.move",
      "inventory.read",
      "menus.read",
      "organization.read",
      "purchasing.read",
      "purchasing.receive",
      "reservations.manage",
      "reservations.read",
      "tables.read",
    ]);
  });

  it("manager no puede crear establecimientos, renombrar la organización ni leer auditoría", () => {
    expect(roleHasPermission("manager", "establishments.create")).toBe(false);
    expect(roleHasPermission("manager", "organization.update")).toBe(false);
    expect(roleHasPermission("manager", "audit.read")).toBe(false);
    expect(roleHasPermission("manager", "establishments.update")).toBe(true);
  });

  it("cada rol solo otorga permisos conocidos", () => {
    for (const r of ROLES) for (const p of permissionsFor(r)) expect(PERMISSIONS).toContain(p);
  });

  it("isRole rechaza valores desconocidos", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
