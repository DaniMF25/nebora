import { InventoryScreen } from "./inventory-screen";

/** Inventario de todos los locales del grupo. */
export default async function GroupInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId } = await params;
  return <InventoryScreen orgId={orgId} requestedTab={(await searchParams).tab} />;
}
