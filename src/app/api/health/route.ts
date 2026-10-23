import { NextResponse } from "next/server";
import { getPool } from "@/server/db/pool";

// Siempre en tiempo de ejecución: comprueba el estado real, nunca una respuesta cacheada.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

/**
 * Comprobación de salud para el balanceador o el orquestador: 200 si la base de
 * datos responde, 503 si no. No devuelve versiones, errores ni detalles internos.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await Promise.race([
      getPool().query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (err) {
    console.error("[health] base de datos no disponible", { message: err instanceof Error ? err.message : "desconocido" });
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
