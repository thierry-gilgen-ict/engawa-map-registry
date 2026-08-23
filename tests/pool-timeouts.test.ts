// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPool } from "../src/db/pool.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

describe("pool session timeouts", () => {
  it("applies statement, lock, and idle-in-transaction timeouts on connect", async () => {
    const pool = createPool(databaseUrl);
    const client = await pool.connect();
    try {
      const statement = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");
      const lock = await client.query<{ lock_timeout: string }>("SHOW lock_timeout");
      const idle = await client.query<{ idle_in_transaction_session_timeout: string }>(
        "SHOW idle_in_transaction_session_timeout",
      );

      expect(statement.rows[0]?.statement_timeout).toBe("30s");
      expect(lock.rows[0]?.lock_timeout).toBe("5s");
      expect(idle.rows[0]?.idle_in_transaction_session_timeout).toBe("1min");
    } finally {
      client.release();
      await pool.end();
    }
  });
});
