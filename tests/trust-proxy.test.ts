// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

describe("trust proxy hops", () => {
  it("uses the socket IP when TRUST_PROXY_HOPS is 0", async () => {
    const pool = createPool(databaseUrl);
    const { app } = buildApp({ pool, logger: false, trustProxyHops: 0 });
    app.get("/_test/ip", async (request) => ({ ip: request.ip }));
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/_test/ip",
      remoteAddress: "203.0.113.10",
      headers: {
        "x-forwarded-for": "198.51.100.20",
      },
    });

    expect(response.json().ip).toBe("203.0.113.10");

    await app.close();
    await pool.end();
  });

  it("trusts a single X-Forwarded-For hop when TRUST_PROXY_HOPS is 1", async () => {
    const pool = createPool(databaseUrl);
    const { app } = buildApp({ pool, logger: false, trustProxyHops: 1 });
    app.get("/_test/ip", async (request) => ({ ip: request.ip }));
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/_test/ip",
      remoteAddress: "10.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.20",
      },
    });

    expect(response.json().ip).toBe("198.51.100.20");

    await app.close();
    await pool.end();
  });

  it("ignores spoofed leftmost XFF entries beyond the trusted hop count", async () => {
    const pool = createPool(databaseUrl);
    const { app } = buildApp({ pool, logger: false, trustProxyHops: 1 });
    app.get("/_test/ip", async (request) => ({ ip: request.ip }));
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/_test/ip",
      remoteAddress: "10.0.0.1",
      headers: {
        "x-forwarded-for": "203.0.113.99, 198.51.100.20",
      },
    });

    expect(response.json().ip).toBe("198.51.100.20");
    expect(response.json().ip).not.toBe("203.0.113.99");

    await app.close();
    await pool.end();
  });
});
