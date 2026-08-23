import { loadConfig } from "./config.js";
import { createPool, runMigrations } from "./db/pool.js";

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";
  process.env.DATABASE_URL ??=
    "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

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
