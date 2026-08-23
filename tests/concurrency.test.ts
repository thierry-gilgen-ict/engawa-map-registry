// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app, pool, samplePayload, uniqueOrigin } from "./helpers.js";
import { hashSiteToken, generateSiteToken } from "./token-helpers.js";

describe("concurrent duplicate origin registration", () => {
  it("returns one success and one conflict", async () => {
    const url = uniqueOrigin();
    const payload = samplePayload(url);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => {
        const token = generateSiteToken();
        return app.inject({
          method: "POST",
          url: "/api/v1/sites",
          headers: {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
            "engawa-map-site-token-hash": hashSiteToken(token),
          },
          payload,
        });
      }),
    );

    const created = attempts.filter((response) => response.statusCode === 201);
    const conflicts = attempts.filter((response) => response.statusCode === 409);

    expect(created).toHaveLength(1);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0]?.json().error.code).toBe("CANONICAL_URL_ALREADY_REGISTERED");

    const rows = await pool.query(
      "SELECT COUNT(*)::int AS count FROM sites WHERE canonical_url = $1",
      [url],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });
});
