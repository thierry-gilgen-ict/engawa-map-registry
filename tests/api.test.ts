// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app, pool, registerSiteRequest, samplePayload, uniqueOrigin } from "./helpers.js";
import { hashSiteToken } from "./token-helpers.js";
import { withTransaction } from "../src/db/pool.js";
import { approveSite } from "../src/services/mutations.js";

describe("registration", () => {
  it("valid registration returns 201 PENDING", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.state).toBe("PENDING");
    expect(body.siteId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).not.toHaveProperty("siteToken");
    expect(token.length).toBeGreaterThan(0);
  });

  it("rejects unknown fields", async () => {
    const url = uniqueOrigin();
    const payload = { ...samplePayload(url), nodeVersion: "24" };
    const { response } = await registerSiteRequest(payload as never);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects invalid canonical URL", async () => {
    const { response } = await registerSiteRequest(samplePayload("https://localhost"));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CANONICAL_URL");
  });

  it("rejects duplicate origin with 409", async () => {
    const url = uniqueOrigin();
    const first = await registerSiteRequest(samplePayload(url));
    expect(first.response.statusCode).toBe(201);

    const second = await registerSiteRequest(samplePayload(url));
    expect(second.response.statusCode).toBe(409);
    expect(second.response.json().error.code).toBe("CANONICAL_URL_ALREADY_REGISTERED");
  });

  it("requires idempotency key", async () => {
    const url = uniqueOrigin();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: {
        "content-type": "application/json",
        "engawa-map-site-token-hash": hashSiteToken("x".repeat(32)),
      },
      payload: samplePayload(url),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid token hash header", async () => {
    const url = uniqueOrigin();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "engawa-map-site-token-hash": "not-a-valid-hash",
      },
      payload: samplePayload(url),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("idempotency", () => {
  it("replays same key with same payload", async () => {
    const url = uniqueOrigin();
    const key = randomUUID();
    const first = await registerSiteRequest(samplePayload(url), {
      idempotencyKey: key,
      token: "consistent-token-value-32bytes!!!!",
    });
    const second = await registerSiteRequest(samplePayload(url), {
      idempotencyKey: key,
      token: "consistent-token-value-32bytes!!!!",
    });
    expect(first.response.statusCode).toBe(201);
    expect(second.response.statusCode).toBe(201);
    expect(second.response.json().siteId).toBe(first.response.json().siteId);
  });

  it("conflicts when payload changes", async () => {
    const url = uniqueOrigin();
    const key = randomUUID();
    const first = await registerSiteRequest(samplePayload(url), { idempotencyKey: key });
    const changed = await registerSiteRequest(
      { ...samplePayload(url), displayName: "Changed Name" },
      { idempotencyKey: key, token: first.token },
    );
    expect(first.response.statusCode).toBe(201);
    expect(changed.response.statusCode).toBe(409);
    expect(changed.response.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("conflicts when token hash changes", async () => {
    const url = uniqueOrigin();
    const key = randomUUID();
    await registerSiteRequest(samplePayload(url), { idempotencyKey: key });
    const changed = await registerSiteRequest(samplePayload(url), { idempotencyKey: key });
    expect(changed.response.statusCode).toBe(409);
    expect(changed.response.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("auth", () => {
  it("status requires bearer", async () => {
    const url = uniqueOrigin();
    const { response } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/sites/${siteId}/status`,
    });
    expect(missing.statusCode).toBe(401);
  });

  it("status rejects invalid bearer", async () => {
    const url = uniqueOrigin();
    const { response } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const bad = await app.inject({
      method: "GET",
      url: `/api/v1/sites/${siteId}/status`,
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("status accepts valid bearer", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const status = await app.inject({
      method: "GET",
      url: `/api/v1/sites/${siteId}/status`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe("PENDING");
  });

  it("rejects token hash supplied as bearer", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const tokenHash = hashSiteToken(token);
    const bad = await app.inject({
      method: "GET",
      url: `/api/v1/sites/${siteId}/status`,
      headers: { authorization: `Bearer ${tokenHash}` },
    });
    expect(bad.statusCode).toBe(401);
  });
});

describe("update", () => {
  it("allows owned metadata updates", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/sites/${siteId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { displayName: "Updated Name" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().displayName).toBe("Updated Name");
  });

  it("rejects state changes", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/sites/${siteId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { state: "LISTED" },
    });
    expect(patched.statusCode).toBe(400);
  });

  it("canonical URL change returns to PENDING", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    await withTransaction(pool, async (client) => {
      await approveSite(client, siteId);
    });
    const newUrl = uniqueOrigin();
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/sites/${siteId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { canonicalUrl: newUrl },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().state).toBe("PENDING");
    expect(patched.json().canonicalUrl).toBe(newUrl);
  });
});

describe("delete", () => {
  it("DELETE returns 204 and revokes token", async () => {
    const url = uniqueOrigin();
    const { response, token } = await registerSiteRequest(samplePayload(url));
    const siteId = response.json().siteId;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/sites/${siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(204);

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/sites/${siteId}/status`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(401);

    const row = await pool.query("SELECT state, token_hash FROM sites WHERE id = $1", [siteId]);
    expect(row.rows[0]?.state).toBe("DELISTED");
    expect(row.rows[0]?.token_hash).toBeNull();
  });
});

describe("public list", () => {
  it("includes only LISTED sites", async () => {
    const pendingUrl = uniqueOrigin();
    const listedUrl = uniqueOrigin();
    const delistedUrl = uniqueOrigin();

    const pending = await registerSiteRequest(samplePayload(pendingUrl));
    const listed = await registerSiteRequest(samplePayload(listedUrl));
    const delisted = await registerSiteRequest(samplePayload(delistedUrl));

    await withTransaction(pool, async (client) => {
      await approveSite(client, listed.response.json().siteId);
    });

    await app.inject({
      method: "DELETE",
      url: `/api/v1/sites/${delisted.response.json().siteId}`,
      headers: { authorization: `Bearer ${delisted.token}` },
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/sites" });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    const ids = body.items.map((item: { siteId: string }) => item.siteId);
    expect(ids).toContain(listed.response.json().siteId);
    expect(ids).not.toContain(pending.response.json().siteId);
    expect(ids).not.toContain(delisted.response.json().siteId);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("token_hash");
      expect(item).not.toHaveProperty("tokenHash");
    }
  });

  it("paginates with bounded limit", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/sites?limit=200" });
    expect(list.statusCode).toBe(400);
  });
});

describe("health", () => {
  it("healthz is alive without database", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
  });

  it("readyz reports database readiness", async () => {
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ready");
  });
});

describe("security", () => {
  it("rejects oversized body with 413", async () => {
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
  });
});
