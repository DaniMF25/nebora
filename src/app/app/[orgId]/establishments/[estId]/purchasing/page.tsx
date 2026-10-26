import { PurchasingScreen } from "../../../purchasing/purchasing-screen";

/** Pedidos de compra de un local (a sus almacenes). */
export default async function EstablishmentPurchasingPage({
  params,
}: {
  params: Promise<{ orgId: string; estId: string }>;
}) {
  const { orgId, estId } = await params;
  return <PurchasingScreen orgId={orgId} establishmentId={estId} />;
}
