import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

/**
 * Defensa en profundidad: aunque la capa de servicios tuviera un fallo (consulta
 * sin filtro, contexto mal fijado), PostgreSQL debe impedir el acceso cruzado.
 * Estas pruebas usan el rol `nebora_app` directamente, sin pasar por servicios.
 */
describe("RLS con el rol de aplicación", () => {
  let alice: AuthUser;
  let bob: AuthUser;
  let orgA: string;
  let orgB: string;
  let estB: string;

  beforeAll(async () => {
    alice = await createTestUser("rls-alice");
    bob = await createTestUser("rls-bob");
    orgA = await createTestOrganization(alice, "rls-a");
    orgB = await createTestOrganization(bob, "rls-b");
    await withTenant(alice, orgA, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "A", slug: `a-${uniqueSuffix()}` }),
    );
    estB = (
      await withTenant(bob, orgB, (tx, ctx) =>
        createEstablishment(tx, ctx, { name: "B", slug: `b-${uniqueSuffix()}` }),
      )
    ).id;
  });

  async function inContext<T>(
    c: pg.Client,
    ctx: { userId?: string; orgId?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    await c.query("BEGIN");
    try {
      if (ctx.userId) await c.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
      if (ctx.orgId) await c.query("SELECT set_config('app.org_id', $1, true)", [ctx.orgId]);
      return await fn();
    } finally {
      await c.query("ROLLBACK");
    }
  }

  it("el rol de aplicación no es superusuario ni omite RLS", async () => {
    await withAppClient(async (c) => {
      const { rows } = await c.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });

  it("sin contexto no se ve ninguna fila de datos de organizaciones", async () => {
    await withAppClient(async (c) => {
      for (const table of ["organizations", "memberships", "establishments", "audit_events"]) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it("SELECT sin filtro solo devuelve filas de la organización del contexto", async () => {
    await withAppClient((c) =>
      inContext(c, { userId: alice.id, orgId: orgA }, async () => {
        const est = await c.query("SELECT organization_id FROM establishments");
        expect(est.rows.length).toBe(1);
        expect(est.rows.every((r) => r.organization_id === orgA)).toBe(true);
        const audit = await c.query("SELECT DISTINCT organization_id FROM audit_events");
        expect(audit.rows.map((r) => r.organization_id)).toEqual([orgA]);
        const orgs = await c.query("SELECT id FROM organizations");
        expect(orgs.rows.map((r) => r.id)).toEqual([orgA]);
      }),
    );
  });

  it("fijar app.org_id a una organización ajena no da acceso (requiere membresía)", async () => {
    await withAppClient((c) =>
      inContext(c, { userId: alice.id, orgId: orgB }, async () => {
        const est = await c.query("SELECT id FROM establishments");
        expect(est.rows).toEqual([]);
        const byId = await c.query("SELECT id FROM establishments WHERE id = $1", [estB]);
        expect(byId.rows).toEqual([]);
        const mem = await c.query("SELECT user_id FROM memberships WHERE organization_id = $1", [orgB]);
        expect(mem.rows).toEqual([]);
      }),
    );
  });

  it("INSERT en otra organización es rechazado por la política", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id, orgId: orgA }, () =>
          c.query("INSERT INTO establishments (organization_id, name, slug) VALUES ($1, 'X', 'xxx')", [orgB]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        inContext(c, { userId: alice.id, orgId: orgB }, () =>
          c.query("INSERT INTO establishments (organization_id, name, slug) VALUES ($1, 'X', 'xxx')", [orgB]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("UPDATE y DELETE sobre filas de otra organización no afectan a ninguna fila", async () => {
    await withAppClient((c) =>
      inContext(c, { userId: alice.id, orgId: orgA }, async () => {
        const upd = await c.query("UPDATE establishments SET name = 'Hackeado' WHERE id = $1", [estB]);
        expect(upd.rowCount).toBe(0);
        const del = await c.query("DELETE FROM establishments WHERE id = $1", [estB]);
        expect(del.rowCount).toBe(0);
      }),
    );
    // Tampoco se puede mover una fila propia a otra organización.
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id, orgId: orgA }, () =>
          c.query("UPDATE establishments SET organization_id = $1", [orgB]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await withAdminClient(async (c) => {
      const { rows } = await c.query("SELECT name FROM establishments WHERE id = $1", [estB]);
      expect(rows[0].name).toBe("B");
    });
  });

  it("no se puede auto-asignar membresía en una organización ajena", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id, orgId: orgB }, () =>
          c.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
            orgB,
            alice.id,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("los eventos de auditoría son de solo inserción", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id, orgId: orgA }, () => c.query("DELETE FROM audit_events")),
      ).rejects.toThrow(/permission denied/);
      await expect(
        inContext(c, { userId: alice.id, orgId: orgA }, () =>
          c.query("UPDATE audit_events SET action = 'x.y'"),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("no se puede falsificar el actor de un evento de auditoría", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id, orgId: orgA }, () =>
          c.query(
            "INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type) VALUES ($1, $2, 'x.y', 'z')",
            [orgA, bob.id],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("el rol de aplicación no puede crear organizaciones directamente", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, { userId: alice.id }, () =>
          c.query("INSERT INTO organizations (name, slug) VALUES ('X', 'directa')"),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("create_organization exige un usuario autenticado en el contexto", async () => {
    await withAppClient(async (c) => {
      await expect(
        inContext(c, {}, () => c.query("SELECT app.create_organization('X', 'sin-usuario')")),
      ).rejects.toThrow(/authenticated active user required/);
    });
  });

  it("las variables de contexto no persisten fuera de la transacción", async () => {
    await withAppClient(async (c) => {
      await inContext(c, { userId: alice.id, orgId: orgA }, async () => undefined);
      const { rows } = await c.query("SELECT count(*)::int AS n FROM establishments");
      expect(rows[0].n).toBe(0);
    });
  });
});
