import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z, ZodError } from "zod";
import {
  invalidCanonicalUrl,
  invalidRequest,
  rateLimited,
  siteNotFound,
  unauthorized,
} from "../errors.js";
import { handleRouteError } from "./errors.js";
import { clientRateLimitKey, type InMemoryRateLimiter } from "../security/rate-limit.js";
import {
  parseBearerToken,
  validateIdempotencyKey,
  validateSiteId,
  validateSiteTokenHash,
} from "../security/token.js";
import {
  patchPayloadSchema,
  publicListResponseSchema,
  registerResponseSchema,
  registrationPayloadSchema,
  statusResponseSchema,
} from "../schemas/api.js";
import { withTransaction } from "../db/pool.js";
import { registerSite, getSiteById, mapStatusResponse } from "../services/sites.js";
import { listListedSites } from "../services/list.js";
import { patchSite, deleteSite } from "../services/mutations.js";
import { authenticateSiteBearer } from "../security/site-auth.js";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

function mapZodError(error: ZodError): never {
  const canonicalIssue = error.issues.find(
    (issue) =>
      issue.path.includes("canonicalUrl") ||
      issue.message.toLowerCase().includes("canonical") ||
      issue.message.toLowerCase().includes("localhost") ||
      issue.message.toLowerCase().includes("scheme must be https") ||
      issue.message.toLowerCase().includes("private or reserved"),
  );
  if (canonicalIssue) {
    throw invalidCanonicalUrl(canonicalIssue.message);
  }
  throw invalidRequest("Invalid request body.");
}

export function registerApiRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; rateLimiter: InMemoryRateLimiter },
): void {
  const { pool, rateLimiter } = deps;

  app.get("/api/v1/sites", async (request, reply) => {
    try {
      const rate = rateLimiter.check("publicRead", clientRateLimitKey(request.ip));
      if (!rate.allowed) {
        throw rateLimited(rate.retryAfterSeconds);
      }

      let query;
      try {
        query = listQuerySchema.parse(request.query);
      } catch (error) {
        if (error instanceof ZodError) {
          throw invalidRequest("Invalid query parameters.");
        }
        throw error;
      }
      const result = await listListedSites(pool, query);
      const body = publicListResponseSchema.parse(result);
      return reply.code(200).send(body);
    } catch (error) {
      handleRouteError(reply, error);
    }
  });

  app.post("/api/v1/sites", async (request, reply) => {
    try {
      const rate = rateLimiter.check("register", clientRateLimitKey(request.ip));
      if (!rate.allowed) {
        throw rateLimited(rate.retryAfterSeconds);
      }

      const idempotencyKey = request.headers["idempotency-key"];
      const tokenHashHeader = request.headers["engawa-map-site-token-hash"];

      if (typeof idempotencyKey !== "string" || !validateIdempotencyKey(idempotencyKey)) {
        throw invalidRequest("Missing or invalid Idempotency-Key header.");
      }
      if (typeof tokenHashHeader !== "string" || !validateSiteTokenHash(tokenHashHeader)) {
        throw invalidRequest("Missing or invalid Engawa-Map-Site-Token-Hash header.");
      }

      let payload;
      try {
        payload = registrationPayloadSchema.parse(request.body);
      } catch (error) {
        if (error instanceof ZodError) {
          mapZodError(error);
        }
        throw error;
      }

      const response = await withTransaction(pool, async (client) =>
        registerSite(client, {
          payload,
          idempotencyKey,
          tokenHash: tokenHashHeader,
        }),
      );

      const body = registerResponseSchema.parse(response);
      return reply.code(201).send(body);
    } catch (error) {
      handleRouteError(reply, error);
    }
  });

  app.get("/api/v1/sites/:siteId/status", async (request, reply) => {
    try {
      const rate = rateLimiter.check("publicRead", clientRateLimitKey(request.ip));
      if (!rate.allowed) {
        throw rateLimited(rate.retryAfterSeconds);
      }

      const { siteId } = request.params as { siteId: string };
      if (!validateSiteId(siteId)) {
        throw invalidRequest("Invalid siteId.");
      }

      const bearer = parseBearerToken(request.headers.authorization);
      if (!bearer) {
        throw unauthorized();
      }

      const status = await withTransaction(pool, async (client) => {
        await authenticateSiteBearer(client, siteId, bearer);
        const site = await getSiteById(client, siteId);
        if (!site) {
          throw siteNotFound();
        }
        return mapStatusResponse(site);
      });

      const body = statusResponseSchema.parse(status);
      return reply.code(200).send(body);
    } catch (error) {
      handleRouteError(reply, error);
    }
  });

  app.patch("/api/v1/sites/:siteId", async (request, reply) => {
    try {
      const rate = rateLimiter.check("authMutation", clientRateLimitKey(request.ip));
      if (!rate.allowed) {
        throw rateLimited(rate.retryAfterSeconds);
      }

      const { siteId } = request.params as { siteId: string };
      if (!validateSiteId(siteId)) {
        throw invalidRequest("Invalid siteId.");
      }

      const bearer = parseBearerToken(request.headers.authorization);
      if (!bearer) {
        throw unauthorized();
      }

      let patch;
      try {
        patch = patchPayloadSchema.parse(request.body);
      } catch (error) {
        if (error instanceof ZodError) {
          mapZodError(error);
        }
        throw error;
      }

      const status = await withTransaction(pool, async (client) => {
        await authenticateSiteBearer(client, siteId, bearer);
        return patchSite(client, siteId, patch);
      });

      const body = statusResponseSchema.parse(status);
      return reply.code(200).send(body);
    } catch (error) {
      handleRouteError(reply, error);
    }
  });

  app.delete("/api/v1/sites/:siteId", async (request, reply) => {
    try {
      const rate = rateLimiter.check("authMutation", clientRateLimitKey(request.ip));
      if (!rate.allowed) {
        throw rateLimited(rate.retryAfterSeconds);
      }

      const { siteId } = request.params as { siteId: string };
      if (!validateSiteId(siteId)) {
        throw invalidRequest("Invalid siteId.");
      }

      const bearer = parseBearerToken(request.headers.authorization);
      if (!bearer) {
        throw unauthorized();
      }

      await withTransaction(pool, async (client) => {
        await authenticateSiteBearer(client, siteId, bearer);
        await deleteSite(client, siteId);
      });

      return reply.code(204).send();
    } catch (error) {
      handleRouteError(reply, error);
    }
  });
}
