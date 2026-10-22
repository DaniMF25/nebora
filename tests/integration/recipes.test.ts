import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  createIngredient,
  createWarehouse,
  listIngredients,
  listStock,
  recordMovement,
  updateIngredient,
} from "@/server/modules/inventory/service";
import { createProduct, getProduct } from "@/server/modules/menus/products";
import {
  applyRecipeAllergens,
  getRecipe,
  listProductCostings,
  produceRecipe,
  removeRecipeLine,
  setRecipeLine,
} from "@/server/modules/recipes/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  warehouse: string;
  rice: string; // g, 2,40 €/kg
  prawns: string; // g, 18 €/kg
  oil: string; // ml, 6 €/l
  eggs: string; // unidades, sin coste
  paella: string; // producto 18,00 €
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  return withTenant(owner, org, async (tx, ctx) => {
    const est = await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` });
    const warehouse = await createWarehouse(tx, ctx, est.id, { name: "Cocina" });
    const rice = (await createIngredient(tx, ctx, { name: "Arroz", baseUnit: "g" })).id;
    const prawns = (await createIngredient(tx, ctx, { name: "Gambas", baseUnit: "g" })).id;
    const oil = (await createIngredient(tx, ctx, { name: "Aceite", baseUnit: "ml" })).id;
    const eggs = (await createIngredient(tx, ctx, { name: "Huevos", baseUnit: "unit" })).id;
    await updateIngredient(tx, ctx, rice, { cost: "2,40" });
    await updateIngredient(tx, ctx, prawns, { cost: "18", allergens: ["crustaceans"] });
    await updateIngredient(tx, ctx, oil, { cost: "6" });
    await updateIngredient(tx, ctx, eggs, { allergens: ["eggs"] });
    const paella = (await createProduct(tx, ctx, { name: "Paella", priceCents: 1800 })).id;
    return { owner, org, warehouse, rice, prawns, oil, eggs, paella };
  });
}

describe("recetas y escandallos", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("rec");
  });

  it("calcula el coste por ración, el margen y el % de coste", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => {
      await setRecipeLine(tx, ctx, f.paella, { ingredientId: f.rice, quantity: "100", unit: "g" }); // 0,24 €
      await setRecipeLine(tx, ctx, f.paella, { ingredientId: f.prawns, quantity: "0,15", unit: "kg" }); // 2,70 €
      await setRecipeLine(tx, ctx, f.paella, { ingredientId: f.oil, quantity: "2", unit: "cl" }); // 0,12 €
    });
    const r = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r.lines.map((l) => [l.ingredientName, l.quantity])).toEqual([
      ["Aceite", "20.000"],
      ["Arroz", "100.000"],
      ["Gambas", "150.000"],
    ]);
    expect(r.costing).toEqual({ costCents: "306.0000", missingCosts: [], costPercent: 17, marginCents: 1494 });

    // Cambiar la cantidad sustituye la línea (no la duplica).
    await withTenant(f.owner, f.org, (tx, ctx) =>
      setRecipeLine(tx, ctx, f.paella, { ingredientId: f.rice, quantity: "120", unit: "g" }),
    );
    const r2 = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r2.lines).toHaveLength(3);
    expect(r2.costing!.costCents).toBe("310.8000");
    const all = await withTenant(f.owner, f.org, (tx, ctx) => listProductCostings(tx, ctx));
    expect(all.get(f.paella)!.costCents).toBe("310.8000");
  });

  it("no inventa costes: con un ingrediente sin coste el escandallo queda incompleto", async () => {
    await withTenant(f.owner, f.org, (tx, ctx) =>
      setRecipeLine(tx, ctx, f.paella, { ingredientId: f.eggs, quantity: "1", unit: "unit" }),
    );
    const r = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r.costing).toEqual({ costCents: null, missingCosts: ["Huevos"], costPercent: null, marginCents: null });
    await withTenant(f.owner, f.org, (tx, ctx) => updateIngredient(tx, ctx, f.eggs, { cost: "0,25" }));
    const r2 = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r2.costing!.costCents).toBe("335.8000");
  });

  it("detecta alérgenos de la receta no declarados en la carta y permite declararlos", async () => {
    const r = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r.undeclaredAllergens).toEqual(["crustaceans", "eggs"]);
    await withTenant(f.owner, f.org, (tx, ctx) => applyRecipeAllergens(tx, ctx, f.paella));
    const product = await withTenant(f.owner, f.org, (tx, ctx) => getProduct(tx, ctx, f.paella));
    expect(product.allergens).toEqual(["crustaceans", "eggs"]);
    const r2 = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r2.undeclaredAllergens).toEqual([]);
  });

  it("valida unidades, cantidades e ingredientes archivados; quita líneas", async () => {
    for (const bad of [
      { ingredientId: f.rice, quantity: "1", unit: "l" },
      { ingredientId: f.rice, quantity: "0", unit: "g" },
      { ingredientId: f.rice, quantity: "1", unit: "g", productId: f.paella },
    ]) {
      await expect(withTenant(f.owner, f.org, (tx, ctx) => setRecipeLine(tx, ctx, f.paella, bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const extra = await withTenant(f.owner, f.org, (tx, ctx) => createIngredient(tx, ctx, { name: "Sal", baseUnit: "g" }));
    await withTenant(f.owner, f.org, (tx, ctx) => updateIngredient(tx, ctx, extra.id, { active: false }));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => setRecipeLine(tx, ctx, f.paella, { ingredientId: extra.id, quantity: "1", unit: "g" })),
    ).rejects.toBeInstanceOf(ValidationError);

    const r = await withTenant(f.owner, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    const eggsLine = r.lines.find((l) => l.ingredientId === f.eggs)!;
    await withTenant(f.owner, f.org, (tx, ctx) => removeRecipeLine(tx, ctx, f.paella, eggsLine.id));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => removeRecipeLine(tx, ctx, f.paella, eggsLine.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Un ingrediente usado en una receta no se puede borrar.
    await expect(withAdminClient((c) => c.query("DELETE FROM ingredients WHERE id = $1", [f.rice]))).rejects.toThrow(
      /recipe_lines_ingredient_fk/,
    );
  });

  it("elaborar raciones descuenta todos los ingredientes, de forma atómica e idempotente", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => {
      for (const [ingredientId, quantity, unit] of [
        [f.rice, "1", "kg"],
        [f.prawns, "0,5", "kg"],
        [f.oil, "1", "l"],
      ] as const) {
        await recordMovement(tx, ctx, {
          warehouseId: f.warehouse,
          ingredientId,
          kind: "receipt",
          quantity,
          unit,
          idempotencyKey: randomUUID(),
        });
      }
    });
    const key = randomUUID();
    const produce = (portions: number, k = key) =>
      withTenant(f.owner, f.org, (tx, ctx) =>
        produceRecipe(tx, ctx, { productId: f.paella, warehouseId: f.warehouse, portions, idempotencyKey: k }),
      );
    const first = await produce(3);
    expect(first.movements).toHaveLength(3);
    expect(first.replayed).toBe(false);
    const again = await produce(3);
    expect(again.replayed).toBe(true);

    const stock = async () =>
      Object.fromEntries(
        (await withTenant(f.owner, f.org, (tx, ctx) => listStock(tx, ctx))).map((l) => [l.ingredientName, l.quantity]),
      );
    expect(await stock()).toEqual({ Arroz: "640.000", Gambas: "50.000", Aceite: "940.000" });

    // 1 ración más necesita 150 g de gambas y solo quedan 50: no se descuenta nada.
    await expect(produce(1, randomUUID())).rejects.toThrow(/Stock insuficiente/);
    expect(await stock()).toEqual({ Arroz: "640.000", Gambas: "50.000", Aceite: "940.000" });

    const noRecipe = await withTenant(f.owner, f.org, (tx, ctx) => createProduct(tx, ctx, { name: "Agua", priceCents: 200 }));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        produceRecipe(tx, ctx, { productId: noRecipe.id, warehouseId: f.warehouse, portions: 1, idempotencyKey: randomUUID() }),
      ),
    ).rejects.toThrow(/no tiene receta/);
  });
});

describe("recetas: permisos sobre costes", () => {
  it("staff ve la receta y los alérgenos, pero no costes ni márgenes, y no edita", async () => {
    const f = await setup("rec-roles");
    await withTenant(f.owner, f.org, (tx, ctx) =>
      setRecipeLine(tx, ctx, f.paella, { ingredientId: f.rice, quantity: "100", unit: "g" }),
    );
    const staff = await createTestUser("rec-staff");
    await addMember(f.org, staff, "staff");
    const r = await withTenant(staff, f.org, (tx, ctx) => getRecipe(tx, ctx, f.paella));
    expect(r.lines).toHaveLength(1);
    expect(r.costing).toBeNull();
    expect(r.lines[0]!.lineCostCents).toBeNull();
    const ingredients = await withTenant(staff, f.org, (tx, ctx) => listIngredients(tx, ctx));
    expect(ingredients.every((i) => i.costCentsPerRef === null)).toBe(true);
    await expect(withTenant(staff, f.org, (tx, ctx) => listProductCostings(tx, ctx))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(staff, f.org, (tx, ctx) => setRecipeLine(tx, ctx, f.paella, { ingredientId: f.oil, quantity: "1", unit: "ml" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("recetas: aislamiento entre organizaciones", () => {
  it("A no lee ni modifica recetas de B ni usa ingredientes de B", async () => {
    const a = await setup("rec-a");
    const b = await setup("rec-b");
    await withTenant(b.owner, b.org, (tx, ctx) =>
      setRecipeLine(tx, ctx, b.paella, { ingredientId: b.rice, quantity: "100", unit: "g" }),
    );
    await expect(withTenant(a.owner, a.org, (tx, ctx) => getRecipe(tx, ctx, b.paella))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => setRecipeLine(tx, ctx, b.paella, { ingredientId: a.rice, quantity: "1", unit: "g" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => setRecipeLine(tx, ctx, a.paella, { ingredientId: b.rice, quantity: "1", unit: "g" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) =>
        produceRecipe(tx, ctx, { productId: b.paella, warehouseId: b.warehouse, portions: 1, idempotencyKey: randomUUID() }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    const costings = await withTenant(a.owner, a.org, (tx, ctx) => listProductCostings(tx, ctx));
    expect(costings.has(b.paella)).toBe(false);
    await withAdminClient(async (c) => {
      await expect(
        c.query("INSERT INTO recipe_lines (organization_id, product_id, ingredient_id, quantity) VALUES ($1, $2, $3, 1)", [
          a.org,
          a.paella,
          b.rice,
        ]),
      ).rejects.toThrow(/recipe_lines_ingredient_fk/);
    });
  });
});
