import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Staging session timeouts applied on each new pool connection (see docs/staging-deployment.md). */
export const POOL_SESSION_TIMEOUTS = {
  statement_timeout: "30s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "60s",
} as const;

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  pool.on("connect", (client: PoolClient) => {
    setImmediate(() => {
      void client
        .query(
          `
          SET statement_timeout = '${POOL_SESSION_TIMEOUTS.statement_timeout}';
          SET lock_timeout = '${POOL_SESSION_TIMEOUTS.lock_timeout}';
          SET idle_in_transaction_session_timeout = '${POOL_SESSION_TIMEOUTS.idle_in_transaction_session_timeout}';
        `,
        )
        .catch(() => undefined);
    });
  });

  return pool;
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const existing = await pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function isDatabaseReady(pool: pg.Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      ["001_initial_registry"],
    );
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function queryOne<T extends QueryResultRow>(
  client: pg.Pool | PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await client.query<T>(sql, params);
  return result.rows[0] ?? null;
}

export function newSiteId(): string {
  return randomUUID();
}

export function toIsoString(date: Date): string {
  return date.toISOString();
}
