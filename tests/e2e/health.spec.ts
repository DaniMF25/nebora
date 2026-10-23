import { expect, test } from "@playwright/test";

test("la comprobación de salud responde sin detalles internos", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok" });
});
