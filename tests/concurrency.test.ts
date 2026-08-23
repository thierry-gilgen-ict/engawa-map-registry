// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { errorResponseSchema } from "../src/schemas/api.js";
import { MAX_BUCKETS, InMemoryRateLimiter } from "../src/security/rate-limit.js";
import { withTransaction } from "../src/db/pool.js";
import { approveSite } from "../src/services/mutations.js";
import { app, pool, registerSiteRequest, samplePayload, uniqueOrigin } from "./helpers.js";
import { generateSiteToken, hashSiteToken } from "./token-helpers.js";

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

describe("concurrent idempotency key registration", () => {
  it("replays same payload and token to one site row", async () => {
    const url = uniqueOrigin();
    const payload = samplePayload(url);
    const idempotencyKey = randomUUID();
    const token = generateSiteToken();
    const tokenHash = hashSiteToken(token);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: "POST",
          url: "/api/v1/sites",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "engawa-map-site-token-hash": tokenHash,
          },
          payload,
        }),
      ),
    );

    expect(attempts.every((response) => response.statusCode === 201)).toBe(true);
    const siteIds = new Set(attempts.map((response) => response.json().siteId));
    expect(siteIds.size).toBe(1);

    const rows = await pool.query(
      "SELECT COUNT(*)::int AS count FROM sites WHERE canonical_url = $1",
      [url],
    );
    expect(rows.rows[0]?.count).toBe(1);

    const idempotencyRows = await pool.query(
      "SELECT COUNT(*)::int AS count FROM idempotency_keys WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    expect(idempotencyRows.rows[0]?.count).toBe(1);
  });

  it("conflicts when payload differs under the same key", async () => {
    const url = uniqueOrigin();
    const idempotencyKey = randomUUID();
    const token = generateSiteToken();
    const tokenHash = hashSiteToken(token);

    const attempts = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/sites",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "engawa-map-site-token-hash": tokenHash,
        },
        payload: samplePayload(url),
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/sites",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "engawa-map-site-token-hash": tokenHash,
        },
        payload: { ...samplePayload(url), displayName: "Different Name" },
      }),
    ]);

    const statuses = attempts.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = attempts.find((response) => response.statusCode === 409);
    expect(conflict?.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("conflicts when token hash differs under the same key", async () => {
    const url = uniqueOrigin();
    const idempotencyKey = randomUUID();
    const payload = samplePayload(url);

    const attempts = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/sites",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "engawa-map-site-token-hash": hashSiteToken(generateSiteToken()),
        },
        payload,
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/sites",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "engawa-map-site-token-hash": hashSiteToken(generateSiteToken()),
        },
        payload,
      }),
    ]);

    const statuses = attempts.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = attempts.find((response) => response.statusCode === 409);
    expect(conflict?.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("request envelope errors", () => {
  it("rejects oversized body with 413 and error envelope", async () => {
    const huge = "x".repeat(20_000);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "engawa-map-site-token-hash": hashSiteToken("x".repeat(32)),
      },
      payload: { displayName: huge, canonicalUrl: uniqueOrigin(), packages: {} },
    });
    expect(response.statusCode).toBe(413);
    expect(errorResponseSchema.parse(response.json())).toEqual({
      error: { code: "INVALID_REQUEST", message: "Request body too large." },
    });
  });

  it("rejects malformed JSON with 400 INVALID_REQUEST", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "engawa-map-site-token-hash": hashSiteToken("x".repeat(32)),
      },
      payload: "{not-json",
    });
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json())).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid JSON request body." },
    });
  });
});

describe("list cursor validation", () => {
  it("rejects bad base64 cursor", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sites?cursor=%%%",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects cursor with invalid uuid", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ listedAt: "2020-01-01T00:00:00.000Z", siteId: "not-a-uuid" }),
      "utf8",
    ).toString("base64url");
    const response = await app.inject({ method: "GET", url: `/api/v1/sites?cursor=${cursor}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects cursor with invalid timestamp", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ listedAt: "yesterday", siteId: randomUUID() }),
      "utf8",
    ).toString("base64url");
    const response = await app.inject({ method: "GET", url: `/api/v1/sites?cursor=${cursor}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("accepts a valid cursor for listed sites", async () => {
    const firstUrl = uniqueOrigin();
    const secondUrl = uniqueOrigin();
    const first = await registerSiteRequest(samplePayload(firstUrl));
    const second = await registerSiteRequest(samplePayload(secondUrl));

    await withTransaction(pool, async (client) => {
      await approveSite(client, first.response.json().siteId);
      await approveSite(client, second.response.json().siteId);
    });

    const listWithoutCursor = await app.inject({ method: "GET", url: "/api/v1/sites?limit=1" });
    expect(listWithoutCursor.statusCode).toBe(200);
    const nextCursor = listWithoutCursor.json().nextCursor;
    expect(nextCursor).toBeTypeOf("string");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/sites?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]?.siteId).not.toBe(listWithoutCursor.json().items[0]?.siteId);
  });
});

describe("rate limiter", () => {
  it("prunes expired buckets on check", () => {
    const limiter = new InMemoryRateLimiter();
    const now = Date.now();
    (
      limiter as unknown as { buckets: Map<string, { count: number; resetAt: number }> }
    ).buckets.set("register:test", { count: 1, resetAt: now - 1 });
    expect(limiter.bucketCount).toBe(1);
    const result = limiter.check("register", "other");
    expect(result.allowed).toBe(true);
    expect(limiter.bucketCount).toBe(1);
  });

  it("fails closed when bucket map is full after prune", () => {
    const limiter = new InMemoryRateLimiter();
    const now = Date.now();
    const buckets = (
      limiter as unknown as { buckets: Map<string, { count: number; resetAt: number }> }
    ).buckets;
    for (let index = 0; index < MAX_BUCKETS; index += 1) {
      buckets.set(`register:key-${index}`, { count: 1, resetAt: now + 60_000 });
    }
    const result = limiter.check("register", "overflow");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
