import { createHash, timingSafeEqual } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_TOKEN_HASH_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashSiteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function constantTimeEqualHash(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function validateSiteId(siteId: string): boolean {
  return UUID_RE.test(siteId);
}

export function validateIdempotencyKey(key: string): boolean {
  return UUID_RE.test(key);
}

export function validateSiteTokenHash(hash: string): boolean {
  return SITE_TOKEN_HASH_RE.test(hash);
}

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  if (!token) {
    return null;
  }
  return token;
}
