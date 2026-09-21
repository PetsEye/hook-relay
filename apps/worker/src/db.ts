import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

declare global {
  // eslint-disable-next-line no-var
  var __workerPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __workerDb: NodePgDatabase<typeof schema> | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__workerPool) {
    globalThis.__workerPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return globalThis.__workerPool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalThis.__workerDb) {
    globalThis.__workerDb = drizzle(getPool(), { schema });
  }
  return globalThis.__workerDb;
}
