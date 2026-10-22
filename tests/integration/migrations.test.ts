import { describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "../../src/server/db/migrate";
import { withAdminClient } from "../support/db";

describe("migraciones", () => {
  it("todas las migraciones se aplicaron desde una base vacía", async () => {
    const files = await loadMigrations();
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT version, checksum FROM schema_migrations ORDER BY version"),
    );
    expect(rows).toEqual(files.map((m) => ({ version: m.version, checksum: m.checksum })));
  });

  it("reaplicar es idempotente", async () => {
    const applied = await withAdminClient((c) => migrate(c));
    expect(applied).toEqual([]);
  });

  it("todas las tablas con organization_id tienen RLS activado", async () => {
    const { rows } = await withAdminClient((c) =>
      c.query(`
        SELECT c.relname, c.relrowsecurity
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind = 'r'`),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });
});
