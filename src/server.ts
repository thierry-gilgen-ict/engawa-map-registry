import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createPool, runMigrations } from "./db/pool.js";

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";
  process.env.DATABASE_URL ??=
    "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  await runMigrations(pool);

  const { app } = buildApp({ pool, logger: config.NODE_ENV !== "test" });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
