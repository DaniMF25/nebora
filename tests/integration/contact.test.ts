import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import {
  CONTACT_RATE_LIMITS,
  deleteMessage,
  listMessages,
  setMessageStatus,
  submitContactMessage,
  unreadMessageCounts,
} from "@/server/modules/contact/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { changePlan } from "@/server/modules/organizations/service";
import { applyRetention, eraseCustomerData, exportCustomerData } from "@/server/modules/privacy/service";
import { setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const profile = {
  theme: "clasico",
  tagline: "",
  heroEyebrow: "",
  heroTitle: "Hola",
  heroText: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  highlights: [],
  featuredMenuId: null,
};

// Formulario de contacto y bandeja de mensajes (D-049).
describe("mensajes de contacto", () => {
  let owner: AuthUser;
  let waiter: AuthUser;
  let org: string;
  let est: string;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);
  const message = (over: Record<string, unknown> = {}) => ({
    customerName: "Laura",
    customerPhone: "",
    customerEmail: `laura-${uniqueSuffix()}@example.test`,
    message: "¿Tenéis menú para celíacos?",
    consent: true,
    website: "",
    idempotencyKey: randomUUID(),
    ...over,
  });

  beforeAll(async () => {
    owner = await createTestUser("ct-owner");
    waiter = await createTestUser("ct-waiter");
    org = await createTestOrganization(owner, "Contacto", "advanced");
    await addMember(org, waiter, "staff");
    est = await asOwner(async (tx, ctx) => {
      const id = (await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` })).id;
      await updateSiteProfile(tx, ctx, id, profile);
      await setSitePublished(tx, ctx, id, { published: true });
      return id;
    });
  });

  it("llega a la bandeja; un reenvío no lo duplica", async () => {
    const m = message();
    expect(await submitContactMessage(est, m, "10.2.0.1")).toEqual({ replayed: false });
    expect(await submitContactMessage(est, m, "10.2.0.1")).toEqual({ replayed: true });
    const inbox = await asOwner((tx, ctx) => listMessages(tx, ctx, est));
    expect(inbox.filter((x) => x.customerEmail === m.customerEmail)).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ customerName: "Laura", status: "new", message: "¿Tenéis menú para celíacos?" });
    expect((await asOwner((tx, ctx) => unreadMessageCounts(tx, ctx))).get(est)).toBeGreaterThan(0);
  });

  it("valida contacto, mensaje, consentimiento y campo trampa", async () => {
    const rejects = (over: Record<string, unknown>) =>
      expect(submitContactMessage(est, message(over), "10.2.0.2")).rejects.toThrow(ValidationError);
    await rejects({ customerEmail: "", customerPhone: "" });
    await rejects({ message: "  " });
    await rejects({ message: "x".repeat(2001) });
    await rejects({ consent: false });
    await rejects({ website: "https://spam.example" });
    await rejects({ customerEmail: "no-es-correo" });
    await rejects({ organizationId: org });
  });

  it("límite por contacto", async () => {
    const email = `repite-${uniqueSuffix()}@example.test`;
    for (let n = 0; n < CONTACT_RATE_LIMITS.perContactPerDay; n++) {
      await submitContactMessage(est, message({ customerEmail: email }), `10.2.1.${n}`);
    }
    await expect(submitContactMessage(est, message({ customerEmail: email }), "10.2.2.1")).rejects.toThrow(
      RateLimitedError,
    );
  });

  it("el personal lee y marca como leído; archivar y borrar es de encargados", async () => {
    const id = (await asOwner((tx, ctx) => listMessages(tx, ctx, est)))[0]!.id;
    await withTenant(waiter, org, async (tx, ctx) => {
      await setMessageStatus(tx, ctx, est, id, { status: "read" });
      await expect(setMessageStatus(tx, ctx, est, id, { status: "archived" })).rejects.toThrow(ForbiddenError);
      await expect(deleteMessage(tx, ctx, est, id)).rejects.toThrow(ForbiddenError);
    });
    await asOwner(async (tx, ctx) => {
      await setMessageStatus(tx, ctx, est, id, { status: "archived" });
      expect((await listMessages(tx, ctx, est)).some((x) => x.id === id)).toBe(false);
      expect((await listMessages(tx, ctx, est, { archived: true })).map((x) => x.id)).toContain(id);
      await deleteMessage(tx, ctx, est, id);
      expect((await listMessages(tx, ctx, est, { archived: true })).map((x) => x.id)).not.toContain(id);
    });
  });

  it("aislamiento: otra organización no los ve y la aplicación no puede insertarlos directamente", async () => {
    const outsider = await createTestUser("ct-out");
    const otherOrg = await createTestOrganization(outsider, "Ajena");
    await expect(withTenant(outsider, otherOrg, (tx, ctx) => listMessages(tx, ctx, est))).rejects.toThrow(
      NotFoundError,
    );
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [outsider.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [otherOrg]);
        expect((await c.query("SELECT count(*)::int AS n FROM contact_messages")).rows[0].n).toBe(0);
        await expect(
          c.query(
            `INSERT INTO contact_messages (organization_id, establishment_id, customer_name, customer_email, message, consent_at)
             VALUES ($1, $2, 'x', 'x@example.test', 'x', now())`,
            [org, est],
          ),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("privacidad: exportación, borrado y retención incluyen los mensajes", async () => {
    const email = `privado-${uniqueSuffix()}@example.test`;
    await submitContactMessage(est, message({ customerEmail: email, message: "Hola" }), "10.2.3.1");
    const exported = await asOwner((tx, ctx) => exportCustomerData(tx, ctx, email));
    expect(exported.messages).toEqual([expect.objectContaining({ email, message: "Hola" })]);
    await asOwner((tx, ctx) => eraseCustomerData(tx, ctx, email));
    expect((await asOwner((tx, ctx) => exportCustomerData(tx, ctx, email))).messages).toEqual([]);

    // Retención: un mensaje de hace más de un año se anonimiza.
    const old = `antiguo-${uniqueSuffix()}@example.test`;
    await submitContactMessage(est, message({ customerEmail: old }), "10.2.3.2");
    await withAdminClient((c) =>
      c.query("UPDATE contact_messages SET created_at = now() - interval '400 days' WHERE customer_email = $1", [old]),
    );
    await asOwner((tx, ctx) => applyRetention(tx, ctx));
    const { rows } = await withAdminClient((c) =>
      c.query(
        "SELECT customer_email, message, anonymized_at FROM contact_messages WHERE customer_name = 'Cliente anonimizado' AND organization_id = $1",
        [org],
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.customer_email === null && r.message === null && r.anonymized_at)).toBe(true);
  });

  it("con la web sin publicar o en plan Básico no se aceptan mensajes", async () => {
    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est, { published: false }));
    await expect(submitContactMessage(est, message(), "10.2.4.1")).rejects.toThrow(ValidationError);
    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est, { published: true }));
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" })).catch(async () => {
      // Hay otro miembro: se quita para poder bajar a Básico.
      await withAdminClient((c) =>
        c.query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, waiter.id]),
      );
      await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" }));
    });
    await expect(submitContactMessage(est, message(), "10.2.4.2")).rejects.toThrow(ValidationError);
  });
});
