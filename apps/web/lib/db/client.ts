import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "../env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __hookrelayPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __hookrelayDb: NodePgDatabase<typeof schema> | undefined;
}

function getPool(): Pool {
  if (!globalThis.__hookrelayPool) {
    globalThis.__hookrelayPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
    });
  }
  return globalThis.__hookrelayPool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalThis.__hookrelayDb) {
    globalThis.__hookrelayDb = drizzle(getPool(), { schema });
  }
  return globalThis.__hookrelayDb;
}

export type Db = ReturnType<typeof getDb>;
