"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { parseEuroAmount } from "@/lib/money";
import { formString, runTenantAction } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import {
  activateVersion,
  addItem,
  addSection,
  deleteMenu,
  deleteSection,
  moveItem,
  moveSection,
  publishMenu,
  removeItem,
  renameSection,
  setItemPrice,
  setMenuAvailability,
  setItemRecommended,
  unpublishMenu,
  updateMenu,
} from "@/server/modules/menus/menus";
import { saveMenuTranslations } from "@/server/modules/translations/service";

// Todos los ids ligados (orgId, menuId, sectionId…) llegan del cliente: los
// servicios comprueban que pertenecen a la carta y a la organización.

const editorPath = (orgId: string, menuId: string) => `/app/${orgId}/menus/${menuId}`;

function optionalPrice(value: string): number | null {
  if (value === "") return null;
  const cents = parseEuroAmount(value);
  if (cents === null) throw new ValidationError("Precio no válido (por ejemplo 12,50)");
  return cents;
}

export async function updateMenuAction(orgId: string, menuId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    editorPath(orgId, menuId),
    (tx, ctx) =>
      updateMenu(tx, ctx, menuId, { name: formString(fd, "name"), slug: formString(fd, "slug"), theme: formString(fd, "theme") }),
    "Guardado",
  );
}

/** Horario de la carta: «siempre» o franjas r<n>d (días), r<n>o, r<n>c (D-036). */
export async function setAvailabilityAction(orgId: string, menuId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const rules: { days: number[]; opens: string; closes: string }[] = [];
  for (let n = 0; n < 20 && fd.has(`r${n}o`); n++) {
    rules.push({
      days: fd.getAll(`r${n}d`).map((d) => Number(d)),
      opens: formString(fd, `r${n}o`),
      closes: formString(fd, `r${n}c`),
    });
  }
  return runTenantAction(
    orgId,
    editorPath(orgId, menuId),
    (tx, ctx) => setMenuAvailability(tx, ctx, menuId, { rules: fd.get("mode") === "always" ? null : rules }),
    "Horario guardado",
  );
}

export async function addSectionAction(orgId: string, menuId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) =>
    addSection(tx, ctx, menuId, { name: formString(fd, "name") }),
  );
}

export async function renameSectionAction(
  orgId: string,
  menuId: string,
  sectionId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) =>
    renameSection(tx, ctx, menuId, sectionId, { name: formString(fd, "name") }),
  );
}

export async function moveSectionAction(
  orgId: string,
  menuId: string,
  sectionId: string,
  direction: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => moveSection(tx, ctx, menuId, sectionId, direction));
}

export async function deleteSectionAction(
  orgId: string,
  menuId: string,
  sectionId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => deleteSection(tx, ctx, menuId, sectionId));
}

export async function addItemAction(
  orgId: string,
  menuId: string,
  sectionId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) =>
    addItem(tx, ctx, menuId, sectionId, {
      productId: formString(fd, "productId"),
      priceOverrideCents: optionalPrice(formString(fd, "price")),
    }),
  );
}

export async function setItemPriceAction(
  orgId: string,
  menuId: string,
  itemId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) =>
    setItemPrice(tx, ctx, menuId, itemId, { priceOverrideCents: optionalPrice(formString(fd, "price")) }),
  );
}

export async function setItemRecommendedAction(
  orgId: string,
  menuId: string,
  itemId: string,
  recommended: boolean,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) =>
    setItemRecommended(tx, ctx, menuId, itemId, { recommended }),
  );
}

export async function moveItemAction(
  orgId: string,
  menuId: string,
  itemId: string,
  direction: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => moveItem(tx, ctx, menuId, itemId, direction));
}

export async function removeItemAction(
  orgId: string,
  menuId: string,
  itemId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => removeItem(tx, ctx, menuId, itemId));
}

export async function publishMenuAction(orgId: string, menuId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  let version = 0;
  const state = await runTenantAction(orgId, editorPath(orgId, menuId), async (tx, ctx) => {
    version = (await publishMenu(tx, ctx, menuId)).versionNumber;
  });
  return state.ok ? { ok: true, message: `Publicada la versión ${version}` } : state;
}

export async function unpublishMenuAction(orgId: string, menuId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => unpublishMenu(tx, ctx, menuId), "Carta despublicada");
}

export async function activateVersionAction(
  orgId: string,
  menuId: string,
  versionId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, editorPath(orgId, menuId), (tx, ctx) => activateVersion(tx, ctx, menuId, versionId));
}

export async function deleteMenuAction(
  orgId: string,
  menuId: string,
  establishmentId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  const state = await runTenantAction(orgId, `/app/${orgId}/establishments/${establishmentId}`, (tx, ctx) =>
    deleteMenu(tx, ctx, menuId),
  );
  if (!state.ok) return state;
  redirect(`/app/${orgId}/establishments/${establishmentId}/menus`);
}

/**
 * Traducciones de la carta a un idioma. Campos: `menuName`, `section:<id>` y,
 * si se pueden editar los productos, `product:<id>:name|description`.
 */
export async function saveMenuTranslationsAction(
  orgId: string,
  menuId: string,
  lang: string,
  withProducts: boolean,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const sections: Record<string, string> = {};
  const products: Record<string, { name: string; description: string }> = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value !== "string") continue;
    const [kind, id, field] = key.split(":");
    if (kind === "section" && id) sections[id] = value;
    if (kind === "product" && id && (field === "name" || field === "description")) {
      products[id] = { ...(products[id] ?? { name: "", description: "" }), [field]: value };
    }
  }
  return runTenantAction(
    orgId,
    editorPath(orgId, menuId),
    (tx, ctx) =>
      saveMenuTranslations(tx, ctx, menuId, lang, {
        menuName: formString(fd, "menuName"),
        sections,
        ...(withProducts ? { products } : {}),
      }),
    "Traducción guardada",
  );
}
