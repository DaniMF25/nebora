import { InventoryScreen } from "../../../inventory/inventory-screen";

/** Inventario de un local: solo sus almacenes, movimientos y recuentos. */
export default async function EstablishmentInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId, estId } = await params;
  return <InventoryScreen orgId={orgId} establishmentId={estId} requestedTab={(await searchParams).tab} />;
}
