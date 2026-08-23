import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool, runMigrations } from "../src/db/pool.js";
import { InMemoryRateLimiter } from "../src/security/rate-limit.js";
import { generateSiteToken, hashSiteToken } from "./token-helpers.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

export const pool = createPool(databaseUrl);
export let app: FastifyInstance;
export let rateLimiter: InMemoryRateLimiter;

export function uniqueOrigin(): string {
  return `https://${randomUUID()}.example.com`;
}

export function samplePayload(canonicalUrl: string) {
  return {
    displayName: "Example Site",
    canonicalUrl,
    packages: {
      "@thierry-gilgen-ict/engawa-core": "0.1.1",
      "@thierry-gilgen-ict/engawa-discovery": "0.1.1",
      "@thierry-gilgen-ict/engawa-mcp": "0.1.1",
      "@thierry-gilgen-ict/engawa-react": "0.1.0",
    },
    hints: {
      framework: "nextjs",
      byaEnabled: true,
      localeCount: 2,
    },
  };
}

export async function registerSiteRequest(
  payload: ReturnType<typeof samplePayload>,
  options: { idempotencyKey?: string; token?: string } = {},
) {
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  const token = options.token ?? generateSiteToken();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sites",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "engawa-map-site-token-hash": hashSiteToken(token),
      "engawa-map-client-version": "0.1.0",
    },
    body: payload,
  });
  return { response, token, idempotencyKey };
}

export async function resetDatabase(): Promise<void> {
  await pool.query("DELETE FROM idempotency_keys");
  await pool.query("DELETE FROM sites");
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  await runMigrations(pool);
  rateLimiter = new InMemoryRateLimiter();
  ({ app } = buildApp({ pool, rateLimiter, logger: false }));
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase();
  rateLimiter.reset();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});
