import "server-only";
import { z } from "zod";
import type { Allergen } from "@/lib/allergens";
import { INPUT_UNITS, parseQuantity, toBase, toNumericString, fromNumericString, type BaseUnit, type InputUnit } from "@/lib/quantity";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import { insertMovement, idempotencyKeySchema, type Movement } from "@/server/modules/inventory/service";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export interface RecipeLine {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  quantity: string;
  allergens: Allergen[];
  ingredientActive: boolean;
  /** Céntimos (numeric) del ingrediente en una ración; null si falta coste o no hay permiso. */
  lineCostCents: string | null;
}

export interface Costing {
  /** Coste por ración en céntimos (numeric); null si la receta está vacía o falta algún coste. */
  costCents: string | null;
  /** Ingredientes sin coste de referencia. */
  missingCosts: string[];
  /** Porcentaje de coste sobre el precio de venta (1 decimal); null si no se puede calcular. */
  costPercent: number | null;
  /** Precio de venta menos coste, en céntimos; null si no se puede calcular. */
  marginCents: number | null;
}

export interface Recipe {
  productId: string;
  productName: string;
  priceCents: number;
  productAllergens: Allergen[];
  lines: RecipeLine[];
  /** Alérgenos presentes en los ingredientes que el producto no declara en la carta. */
  undeclaredAllergens: Allergen[];
  /** Null si el usuario no tiene permiso para ver costes. */
  costing: Costing | null;
}

// Coste de una línea: cantidad (unidad base) × céntimos por kg|l|ud ÷ factor.
const LINE_COST_SQL = `(r.quantity * i.cost_cents_per_ref / CASE i.base_unit WHEN 'unit' THEN 1 ELSE 1000 END)`;

export const setRecipeLineSchema = z
  .object({
    ingredientId: z.string(),
    quantity: z.string().trim().min(1, "Indica una cantidad"),
    unit: z.enum(Object.keys(INPUT_UNITS) as [InputUnit, ...InputUnit[]]),
  })
  .strict();

export const produceSchema = z
  .object({
    productId: z.string(),
    warehouseId: z.string(),
    portions: z.number().int().min(1).max(1000),
    note: z.string().trim().max(200).optional(),
    // Se derivan claves por ingrediente (clave:ingrediente), de ahí el máximo menor.
    idempotencyKey: idempotencyKeySchema.and(z.string().max(60)),
  })
  .strict();

function computeCosting(priceCents: number, lines: { name: string; lineCost: string | null }[]): Costing {
  const missingCosts = lines.filter((l) => l.lineCost === null).map((l) => l.name);
  if (lines.length === 0 || missingCosts.length > 0) {
    return { costCents: null, missingCosts, costPercent: null, marginCents: null };
  }
  // Suma exacta en céntimos con 4 decimales mediante enteros.
  const total = lines.reduce((acc, l) => acc + BigInt(Math.round(Number(l.lineCost) * 10000)), 0n);
  const costCents = (Number(total) / 10000).toFixed(4);
  const cost = Number(costCents);
  return {
    costCents,
    missingCosts,
    costPercent: priceCents > 0 ? Math.round((cost / priceCents) * 1000) / 10 : null,
    marginCents: Math.round(priceCents - cost),
  };
}

async function loadProduct(tx: Tx, ctx: TenantContext, productId: string) {
  if (!isUuid(productId)) throw new NotFoundError();
  const { rows } = await tx.query<{ name: string; price_cents: number; allergens: Allergen[] }>(
    "SELECT name, price_cents, allergens FROM menu_products WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, productId],
  );
  if (!rows[0]) throw new NotFoundError("Producto no encontrado");
  return rows[0];
}

export async function getRecipe(tx: Tx, ctx: TenantContext, productId: string): Promise<Recipe> {
  requirePermission(ctx, "menus.read");
  const product = await loadProduct(tx, ctx, productId);
  const { rows } = await tx.query<Omit<RecipeLine, "lineCostCents"> & { lineCost: string | null }>(
    `SELECT r.id, r.ingredient_id AS "ingredientId", i.name AS "ingredientName", i.base_unit AS "baseUnit",
            r.quantity::text AS quantity, i.allergens, i.active AS "ingredientActive",
            ${LINE_COST_SQL}::text AS "lineCost"
       FROM recipe_lines r
       JOIN ingredients i ON i.organization_id = r.organization_id AND i.id = r.ingredient_id
      WHERE r.organization_id = $1 AND r.product_id = $2
      ORDER BY i.name`,
    [ctx.organizationId, productId],
  );
  const canSeeCosts = ctx.permissions.has("costs.read");
  const declared = new Set(product.allergens);
  const undeclared = [...new Set(rows.flatMap((r) => r.allergens))].filter((a) => !declared.has(a)).sort();
  return {
    productId,
    productName: product.name,
    priceCents: product.price_cents,
    productAllergens: product.allergens,
    undeclaredAllergens: undeclared,
    lines: rows.map(({ lineCost, ...r }) => ({ ...r, lineCostCents: canSeeCosts ? lineCost : null })),
    costing: canSeeCosts
      ? computeCosting(product.price_cents, rows.map((r) => ({ name: r.ingredientName, lineCost: r.lineCost })))
      : null,
  };
}

/** Escandallo resumido de todos los productos (para el listado). Requiere costs.read. */
export async function listProductCostings(tx: Tx, ctx: TenantContext): Promise<Map<string, Costing>> {
  requirePermission(ctx, "costs.read");
  const { rows } = await tx.query<{ product_id: string; price_cents: number; name: string; line_cost: string | null }>(
    `SELECT r.product_id, p.price_cents, i.name, ${LINE_COST_SQL}::text AS line_cost
       FROM recipe_lines r
       JOIN menu_products p ON p.organization_id = r.organization_id AND p.id = r.product_id
       JOIN ingredients i ON i.organization_id = r.organization_id AND i.id = r.ingredient_id
      WHERE r.organization_id = $1`,
    [ctx.organizationId],
  );
  const grouped = new Map<string, { price: number; lines: { name: string; lineCost: string | null }[] }>();
  for (const r of rows) {
    const g = grouped.get(r.product_id) ?? { price: r.price_cents, lines: [] };
    g.lines.push({ name: r.name, lineCost: r.line_cost });
    grouped.set(r.product_id, g);
  }
  return new Map([...grouped].map(([id, g]) => [id, computeCosting(g.price, g.lines)]));
}

/** Añade un ingrediente a la receta o actualiza su cantidad por ración. */
export async function setRecipeLine(tx: Tx, ctx: TenantContext, productId: string, input: unknown): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  const data = parseInput(setRecipeLineSchema, input);
  await loadProduct(tx, ctx, productId);
  if (!isUuid(data.ingredientId)) throw new NotFoundError("Ingrediente no encontrado");
  const ing = await tx.query<{ base_unit: BaseUnit; active: boolean }>(
    "SELECT base_unit, active FROM ingredients WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, data.ingredientId],
  );
  const ingredient = ing.rows[0];
  if (!ingredient) throw new NotFoundError("Ingrediente no encontrado");
  if (!ingredient.active) throw new ValidationError("El ingrediente está archivado");
  const amount = parseQuantity(data.quantity);
  const base = amount === null ? null : toBase(amount, data.unit, ingredient.base_unit);
  if (base === null) throw new ValidationError("Cantidad o unidad no válida para este ingrediente");

  await tx.query(
    `INSERT INTO recipe_lines (organization_id, product_id, ingredient_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [ctx.organizationId, productId, data.ingredientId, toNumericString(base)],
  );
  await recordAudit(tx, ctx, { action: "recipe.line_set", entityType: "product", entityId: productId });
}

export async function removeRecipeLine(tx: Tx, ctx: TenantContext, productId: string, lineId: string): Promise<void> {
  requirePermission(ctx, "catalog.manage");
  if (!isUuid(productId) || !isUuid(lineId)) throw new NotFoundError();
  const res = await tx.query("DELETE FROM recipe_lines WHERE organization_id = $1 AND product_id = $2 AND id = $3", [
    ctx.organizationId,
    productId,
    lineId,
  ]);
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "recipe.line_removed", entityType: "product", entityId: productId });
}

/** Declara en el producto los alérgenos que aportan los ingredientes de su receta. */
export async function applyRecipeAllergens(tx: Tx, ctx: TenantContext, productId: string): Promise<Allergen[]> {
  requirePermission(ctx, "catalog.manage");
  const recipe = await getRecipe(tx, ctx, productId);
  if (recipe.undeclaredAllergens.length === 0) return recipe.productAllergens;
  const merged = [...new Set([...recipe.productAllergens, ...recipe.undeclaredAllergens])].sort();
  await tx.query("UPDATE menu_products SET allergens = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    productId,
    merged,
  ]);
  await recordAudit(tx, ctx, {
    action: "product.allergens_from_recipe",
    entityType: "product",
    entityId: productId,
    metadata: { added: recipe.undeclaredAllergens },
  });
  return merged;
}

/**
 * Registra la elaboración de N raciones: descuenta cada ingrediente de la
 * receta en el almacén indicado. Todo en una transacción (si falta stock de
 * un ingrediente no se descuenta ninguno) e idempotente por clave.
 */
export async function produceRecipe(
  tx: Tx,
  ctx: TenantContext,
  input: unknown,
): Promise<{ movements: Movement[]; replayed: boolean }> {
  requirePermission(ctx, "inventory.move");
  const data = parseInput(produceSchema, input);
  if (!isUuid(data.warehouseId)) throw new NotFoundError("Almacén no encontrado");
  const product = await loadProduct(tx, ctx, data.productId);
  const wh = await tx.query("SELECT 1 FROM warehouses WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    data.warehouseId,
  ]);
  if (wh.rowCount !== 1) throw new NotFoundError("Almacén no encontrado");

  const { rows: lines } = await tx.query<{ ingredient_id: string; quantity: string; active: boolean }>(
    `SELECT r.ingredient_id, r.quantity::text AS quantity, i.active
       FROM recipe_lines r JOIN ingredients i ON i.organization_id = r.organization_id AND i.id = r.ingredient_id
      WHERE r.organization_id = $1 AND r.product_id = $2 ORDER BY r.ingredient_id`,
    [ctx.organizationId, data.productId],
  );
  if (lines.length === 0) throw new ValidationError("El producto no tiene receta");
  if (lines.some((l) => !l.active)) throw new ValidationError("La receta incluye ingredientes archivados");

  const note = data.note || `Elaboración: ${data.portions} × ${product.name}`;
  const results = [];
  for (const l of lines) {
    const delta = -fromNumericString(l.quantity) * BigInt(data.portions);
    results.push(
      await insertMovement(tx, ctx, {
        warehouseId: data.warehouseId,
        ingredientId: l.ingredient_id,
        kind: "consumption",
        delta: toNumericString(delta),
        note,
        idempotencyKey: `${data.idempotencyKey}:${l.ingredient_id}`,
        correctsMovementId: null,
      }),
    );
  }
  return { movements: results.map((r) => r.movement), replayed: results.every((r) => r.replayed) };
}
