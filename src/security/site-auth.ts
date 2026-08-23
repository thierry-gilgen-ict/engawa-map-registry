import type { PoolClient } from "pg";
import { constantTimeEqualHash, hashSiteToken } from "../security/token.js";
import { siteNotFound, unauthorized } from "../errors.js";
import { getSiteById } from "../services/sites.js";

export async function authenticateSiteBearer(
  client: PoolClient,
  siteId: string,
  rawToken: string,
): Promise<void> {
  const site = await getSiteById(client, siteId);
  if (!site) {
    throw siteNotFound();
  }
  if (!site.token_hash) {
    throw unauthorized();
  }

  const derived = hashSiteToken(rawToken);
  if (!constantTimeEqualHash(derived, site.token_hash)) {
    throw unauthorized();
  }
}
