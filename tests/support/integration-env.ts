import { afterAll, inject } from "vitest";
import { closePool } from "@/server/db/pool";

process.env.DATABASE_URL = inject("appDatabaseUrl");
process.env.AUTH_ALLOW_SIGNUP = "false";

afterAll(async () => {
  await closePool();
});
