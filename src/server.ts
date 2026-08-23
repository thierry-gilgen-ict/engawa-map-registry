import { pathToFileURL } from "node:url";
import type pg from "pg";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createPool } from "./db/pool.js";

/** Pool reference for graceful shutdown (DM2B). */
export let pool: pg.Pool | undefined;

let shuttingDown = false;

type RegistryApp = ReturnType<typeof buildApp>["app"];

export async function gracefulShutdown(
  signal: string,
  app: RegistryApp,
  activePool: pg.Pool,
): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  app.log.info({ signal }, "Shutting down gracefully");

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "Error closing HTTP server");
  }

  try {
    await activePool.end();
  } catch (error) {
    app.log.error({ err: error }, "Error closing database pool");
  }

  process.exit(0);
}

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";
  process.env.DATABASE_URL ??=
    "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);

  const { app } = buildApp({
    pool,
    logger: config.NODE_ENV !== "test",
    trustProxy: config.TRUST_PROXY,
  });

  const shutdown = (signal: string) => {
    void gracefulShutdown(signal, app, pool!);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void main();
}
