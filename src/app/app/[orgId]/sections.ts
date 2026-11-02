import type { SectionLink } from "@/components/panel/section-switch";

// Apartados de las secciones de Gestión y de «Turnos y horarios» (D-046):
// lo común de la organización y, al lado, cada local.

type Local = { id: string; name: string };

export function inventoryLinks(
  orgId: string,
  locals: Local[],
  current: "ingredients" | "group" | string,
): SectionLink[] {
  const base = `/app/${orgId}`;
  return [
    { href: `${base}/ingredients`, label: "Ingredientes", current: current === "ingredients" },
    ...(locals.length > 1
      ? [{ href: `${base}/inventory`, label: "Todos los locales", current: current === "group" }]
      : []),
    ...locals.map((e) => ({
      href: `${base}/establishments/${e.id}/inventory`,
      label: locals.length > 1 ? e.name : "Stock y movimientos",
      current: current === e.id,
    })),
  ];
}

export function supplierLinks(orgId: string, locals: Local[], current: "suppliers" | "group" | string): SectionLink[] {
  const base = `/app/${orgId}`;
  return [
    { href: `${base}/suppliers`, label: "Proveedores", current: current === "suppliers" },
    ...(locals.length > 1
      ? [{ href: `${base}/purchasing`, label: "Pedidos de todos los locales", current: current === "group" }]
      : []),
    ...locals.map((e) => ({
      href: `${base}/establishments/${e.id}/purchasing`,
      label: locals.length > 1 ? `Pedidos de ${e.name}` : "Pedidos de compra",
      current: current === e.id,
    })),
  ];
}

export function staffLinks(orgId: string, locals: Local[], current: "people" | string): SectionLink[] {
  const base = `/app/${orgId}`;
  return [
    { href: `${base}/staff`, label: "Personal", current: current === "people" },
    ...locals.map((e) => ({
      href: `${base}/establishments/${e.id}/staff`,
      label: locals.length > 1 ? `Turnos de ${e.name}` : "Cuadrante de turnos",
      current: current === e.id,
    })),
  ];
}
