import { PurchasingScreen } from "./purchasing-screen";

/** Pedidos de compra de todos los locales del grupo. */
export default async function GroupPurchasingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return <PurchasingScreen orgId={orgId} />;
}
