// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { gracefulShutdown } from "../src/server.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

describe("graceful shutdown", () => {
  it("closes the HTTP server and database pool", async () => {
    const pool = createPool(databaseUrl);
    const { app } = buildApp({ pool, logger: false });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await gracefulShutdown("SIGTERM", app, pool);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(app.server.listening).toBe(false);

    exitSpy.mockRestore();
  });
});
