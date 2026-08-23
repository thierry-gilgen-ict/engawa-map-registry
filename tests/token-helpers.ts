import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";

export function generateSiteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSiteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
