import type { OrderStatus } from "@/server/modules/purchasing/service";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Borrador",
  sent: "Enviado",
  partially_received: "Recibido en parte",
  received: "Recibido",
  cancelled: "Cancelado",
};
