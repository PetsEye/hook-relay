import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { env } from "../env";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[db] migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db] migration failed", err);
  process.exit(1);
});
