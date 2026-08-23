import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { Pool } from "pg";
import { MAX_REQUEST_BODY_BYTES } from "./constants.js";
import { registerApiRoutes } from "./api/routes.js";
import { isDatabaseReady } from "./db/pool.js";
import { InMemoryRateLimiter } from "./security/rate-limit.js";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "engawa-map-site-token-hash"]);

export interface BuildAppOptions {
  pool: Pool;
  rateLimiter?: InMemoryRateLimiter;
  logger?: boolean;
  /** When true, trust the reverse proxy for request.ip (single Traefik hop in staging). */
  trustProxy?: boolean;
}

export function buildApp(options: BuildAppOptions) {
  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
    trustProxy: options.trustProxy === true,
  });

  app.addHook("onRequest", async (request) => {
    request.startTime = Date.now();
    if (request.url === "/healthz" || request.url === "/readyz") {
      return;
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const duration = Date.now() - (request.startTime ?? Date.now());
    const safeHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
        safeHeaders[key] = Array.isArray(value) ? value.join(",") : (value ?? "");
      }
    }
    if (options.logger) {
      request.log.info({
        reqId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        statusCode: reply.statusCode,
        durationMs: duration,
      });
    }
  });

  app.get("/healthz", async (_request, reply) => {
    return reply.code(200).send({ status: "ok" });
  });

  app.get("/readyz", async (_request, reply) => {
    const ready = await isDatabaseReady(options.pool);
    if (!ready) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return reply.code(200).send({ status: "ready" });
  });

  registerApiRoutes(app, { pool: options.pool, rateLimiter });

  app.setErrorHandler((error, request, reply) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;
    if (code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH" || code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      void reply.code(413).send({
        error: { code: "INVALID_REQUEST", message: "Request body too large." },
      });
      return;
    }
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      void reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid JSON request body." },
      });
      return;
    }
    request.log.error({ err: error, reqId: request.id });
    void reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  });

  return { app, rateLimiter };
}

declare module "fastify" {
  interface FastifyRequest {
    startTime?: number;
  }
}
