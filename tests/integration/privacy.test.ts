import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  applyRetention,
  eraseCustomerData,
  exportCustomerData,
  findCustomerData,
  getPrivacySettings,
  normalizeContact,
  updatePrivacySettings,
} from "@/server/modules/privacy/service";
import { listAuditEvents } from "@/server/audit/audit";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  est: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const est = await withTenant(owner, org, async (tx, ctx) =>
    (await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` })).id,
  );
  return { owner, org, est };
}

/** Siembra una reserva con fechas arbitrarias (pasadas o futuras). */
async function seed(
  f: Fixture,
  o: { daysAgo: number; name: string; phone?: string | null; email?: string | null; status?: string; notes?: string | null },
): Promise<string> {
  const { rows } = await withAdminClient((c) =>
    c.query(
      `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status,
                                 customer_name, customer_phone, customer_email, notes)
       VALUES ($1, $2, now() - make_interval(days => $3) , now() - make_interval(days => $3) + interval '90 minutes',
               2, $4, $5, $6, $7, $8) RETURNING id`,
      [f.org, f.est, o.daysAgo, o.status ?? "completed", o.name, o.phone ?? null, o.email ?? null, o.notes ?? null],
    ),
  );
  return rows[0].id;
}

async function row(id: string) {
  const { rows } = await withAdminClient((c) =>
    c.query("SELECT customer_name, customer_phone, customer_email, notes, anonymized_at, party_size FROM reservations WHERE id = $1", [id]),
  );
  return rows[0];
}

describe("contactos", () => {
  it("normaliza correos y teléfonos", () => {
    expect(normalizeContact(" Ana@Example.TEST ")).toEqual({ kind: "email", value: "ana@example.test" });
    expect(normalizeContact("+34 600-123 456")).toEqual({ kind: "phone", value: "+34600123456" });
    for (const bad of ["", "abc", "12", "a@", 42]) expect(() => normalizeContact(bad), String(bad)).toThrow(ValidationError);
  });
});

describe("retención de datos de clientes", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("priv");
  });

  it("anonimiza solo las reservas que superan el plazo y conserva los datos no personales", async () => {
    await withTenant(f.owner, f.org, (tx, ctx) => updatePrivacySettings(tx, ctx, { customerRetentionDays: 90 }));
    const old = await seed(f, { daysAgo: 120, name: "Antiguo", phone: "600000001", email: "antiguo@example.test", notes: "Alergia" });
    const recent = await seed(f, { daysAgo: 30, name: "Reciente", email: "reciente@example.test" });
    const n = await withTenant(f.owner, f.org, (tx, ctx) => applyRetention(tx, ctx));
    expect(n).toBe(1);
    expect(await row(old)).toMatchObject({
      customer_name: "Cliente anonimizado",
      customer_phone: null,
      customer_email: null,
      notes: null,
      party_size: 2,
    });
    expect((await row(old)).anonymized_at).not.toBeNull();
    expect(await row(recent)).toMatchObject({ customer_name: "Reciente", anonymized_at: null });
    // Idempotente.
    expect(await withTenant(f.owner, f.org, (tx, ctx) => applyRetention(tx, ctx))).toBe(0);
    const events = await withTenant(f.owner, f.org, (tx, ctx) => listAuditEvents(tx, ctx));
    expect(events.find((e) => e.action === "privacy.retention_applied")?.metadata).toMatchObject({ anonymized: 1, retentionDays: 90 });
  });

  it("el plazo se valida y por defecto es 365 días", async () => {
    const g = await setup("priv-default");
    expect(await withTenant(g.owner, g.org, (tx, ctx) => getPrivacySettings(tx, ctx))).toEqual({ customerRetentionDays: 365 });
    for (const bad of [{ customerRetentionDays: 10 }, { customerRetentionDays: 5000 }, { customerRetentionDays: 90, x: 1 }]) {
      await expect(withTenant(g.owner, g.org, (tx, ctx) => updatePrivacySettings(tx, ctx, bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("el script programado aplica la retención en todas las organizaciones", async () => {
    const g = await setup("priv-job");
    const id = await seed(g, { daysAgo: 400, name: "Muy antiguo", email: "x@example.test" });
    await withAdminClient(async (c) => {
      const { rows } = await c.query("SELECT app.anonymize_expired_reservations($1) AS n", [g.org]);
      expect(rows[0].n).toBe(1);
      const purged = await c.query("SELECT app.purge_rate_limits(48) AS n");
      expect(purged.rows[0].n).toBeGreaterThanOrEqual(0);
    });
    expect((await row(id)).customer_name).toBe("Cliente anonimizado");
  });
});

describe("acceso y borrado a petición del cliente", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("priv-rights");
  });

  it("encuentra y exporta los datos por correo o teléfono, sin datos de otros clientes", async () => {
    await seed(f, { daysAgo: 10, name: "Laura", email: "laura@example.test", phone: "+34 611 222 333" });
    await seed(f, { daysAgo: 5, name: "Laura P.", phone: "+34611222333" });
    await seed(f, { daysAgo: 5, name: "Otra persona", email: "otra@example.test" });
    const byPhone = await withTenant(f.owner, f.org, (tx, ctx) => findCustomerData(tx, ctx, "+34 611-222-333"));
    expect(byPhone.map((r) => r.customerName).sort()).toEqual(["Laura", "Laura P."]);
    const exported = await withTenant(f.owner, f.org, (tx, ctx) => exportCustomerData(tx, ctx, "LAURA@example.test"));
    expect(exported.reservations.map((r) => r.name)).toEqual(["Laura"]);
    expect(JSON.stringify(exported)).not.toContain("Otra persona");
    const events = await withTenant(f.owner, f.org, (tx, ctx) => listAuditEvents(tx, ctx));
    const audit = events.find((e) => e.action === "privacy.exported")!;
    expect(JSON.stringify(audit.metadata)).not.toContain("laura");
  });

  it("no borra si hay reservas futuras activas; tras cancelarlas, anonimiza todas", async () => {
    const future = await withAdminClient(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status, customer_name, customer_email)
         VALUES ($1, $2, now() + interval '3 days', now() + interval '3 days 90 minutes', 2, 'confirmed', 'Laura', 'laura@example.test')
         RETURNING id`,
        [f.org, f.est],
      );
      return rows[0].id as string;
    });
    await expect(withTenant(f.owner, f.org, (tx, ctx) => eraseCustomerData(tx, ctx, "laura@example.test"))).rejects.toThrow(
      /reserva\(s\) futura\(s\) activa\(s\)/,
    );
    await withAdminClient((c) => c.query("UPDATE reservations SET status = 'cancelled' WHERE id = $1", [future]));
    const n = await withTenant(f.owner, f.org, (tx, ctx) => eraseCustomerData(tx, ctx, "laura@example.test"));
    expect(n).toBe(2);
    expect(await withTenant(f.owner, f.org, (tx, ctx) => findCustomerData(tx, ctx, "laura@example.test"))).toEqual([]);
    // Las reservas solo por teléfono siguen hasta que se pidan por ese contacto.
    expect(await withTenant(f.owner, f.org, (tx, ctx) => findCustomerData(tx, ctx, "+34611222333"))).toHaveLength(1);
    expect((await row(future)).customer_name).toBe("Cliente anonimizado");
  });

  it("la BD impide anonimizar dejando datos de contacto", async () => {
    const id = await seed(f, { daysAgo: 3, name: "X", email: "x2@example.test" });
    await withAdminClient(async (c) => {
      await expect(c.query("UPDATE reservations SET anonymized_at = now() WHERE id = $1", [id])).rejects.toThrow(
        /reservations_anonymized_check/,
      );
    });
  });
});

describe("privacidad: permisos y aislamiento", () => {
  it("solo owner/admin; manager y staff no", async () => {
    const f = await setup("priv-roles");
    const manager = await createTestUser("priv-manager");
    const admin = await createTestUser("priv-admin");
    await addMember(f.org, manager, "manager");
    await addMember(f.org, admin, "admin");
    for (const op of [
      (tx: never, ctx: never) => getPrivacySettings(tx, ctx),
      (tx: never, ctx: never) => applyRetention(tx, ctx),
      (tx: never, ctx: never) => findCustomerData(tx, ctx, "a@example.test"),
      (tx: never, ctx: never) => eraseCustomerData(tx, ctx, "a@example.test"),
    ]) {
      await expect(withTenant(manager, f.org, op as never)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(withTenant(admin, f.org, (tx, ctx) => applyRetention(tx, ctx))).resolves.toBe(0);
  });

  it("A no puede consultar, borrar ni aplicar la retención sobre datos de B", async () => {
    const a = await setup("priv-a");
    const b = await setup("priv-b");
    const idB = await seed(b, { daysAgo: 1000, name: "Cliente de B", email: "comun@example.test" });
    expect(await withTenant(a.owner, a.org, (tx, ctx) => findCustomerData(tx, ctx, "comun@example.test"))).toEqual([]);
    expect(await withTenant(a.owner, a.org, (tx, ctx) => eraseCustomerData(tx, ctx, "comun@example.test"))).toBe(0);
    await expect(withTenant(a.owner, b.org, (tx, ctx) => applyRetention(tx, ctx))).rejects.toBeInstanceOf(NotFoundError);
    // Llamada directa a la función con el id de B desde el contexto de A.
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
      await expect(c.query("SELECT app.anonymize_expired_reservations($1)", [b.org])).rejects.toThrow(/not allowed/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
      await expect(c.query("UPDATE privacy_settings SET customer_retention_days = 30 WHERE organization_id = $1", [b.org])).resolves.toMatchObject({ rowCount: 0 });
      await c.query("ROLLBACK");
    });
    expect((await row(idB)).customer_name).toBe("Cliente de B");
  });
});
