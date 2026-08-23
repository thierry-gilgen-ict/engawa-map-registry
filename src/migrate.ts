import { loadConfig } from "./config.js";
import { createPool, runMigrations } from "./db/pool.js";

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    await runMigrations(pool);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

void main();
