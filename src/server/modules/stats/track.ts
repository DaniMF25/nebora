import "server-only";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { isCountableView, isPrefetchRequest } from "@/lib/view-filter";
import { sessionCookieName } from "@/server/auth/current-user";

/**
 * Registra una visita después de enviar la respuesta (no retrasa la página)
 * si la petición cuenta como visita real (ver isCountableView).
 */
export async function trackView(record: () => Promise<boolean>): Promise<void> {
  const h = await headers();
  const countable = isCountableView({
    userAgent: h.get("user-agent"),
    prefetch: isPrefetchRequest((name) => h.get(name)),
    hasSession: (await cookies()).has(sessionCookieName()),
  });
  if (countable) after(record);
}
