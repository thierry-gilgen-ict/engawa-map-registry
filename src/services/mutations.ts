import type { PoolClient } from "pg";
import type { PatchPayload } from "../schemas/api.js";
import {
  canonicalUrlAlreadyRegistered,
  isUniqueViolation,
  siteDelisted,
  siteNotFound,
} from "../errors.js";
import { getSiteById, mapStatusResponse, type SiteRow } from "./sites.js";

export async function patchSite(
  client: PoolClient,
  siteId: string,
  patch: PatchPayload,
): Promise<ReturnType<typeof mapStatusResponse>> {
  const site = await getSiteById(client, siteId);
  if (!site) {
    throw siteNotFound();
  }
  if (site.state === "DELISTED") {
    throw siteDelisted();
  }

  const displayName = patch.displayName ?? site.display_name;
  const canonicalUrl = patch.canonicalUrl ?? site.canonical_url;
  const packages = patch.packages ?? site.packages;
  const hints = patch.hints === null ? null : patch.hints !== undefined ? patch.hints : site.hints;

  let nextState = site.state;
  if (patch.canonicalUrl !== undefined && patch.canonicalUrl !== site.canonical_url) {
    nextState = "PENDING";
  }

  try {
    await client.query(
      `UPDATE sites
       SET display_name = $2,
           canonical_url = $3,
           packages = $4::jsonb,
           hints = $5::jsonb,
           state = $6,
           listed_at = CASE WHEN $6 = 'PENDING' THEN NULL ELSE listed_at END,
           updated_at = NOW()
       WHERE id = $1`,
      [
        siteId,
        displayName,
        canonicalUrl,
        JSON.stringify(packages),
        hints ? JSON.stringify(hints) : null,
        nextState,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw canonicalUrlAlreadyRegistered();
    }
    throw error;
  }

  const updated = await getSiteById(client, siteId);
  if (!updated) {
    throw siteNotFound();
  }
  return mapStatusResponse(updated);
}

export async function deleteSite(client: PoolClient, siteId: string): Promise<void> {
  const site = await getSiteById(client, siteId);
  if (!site) {
    throw siteNotFound();
  }
  if (site.state === "DELISTED") {
    throw siteDelisted();
  }

  await client.query(
    `UPDATE sites
     SET state = 'DELISTED',
         token_hash = NULL,
         delisted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [siteId],
  );
}

export async function approveSite(client: PoolClient, siteId: string): Promise<SiteRow> {
  const site = await getSiteById(client, siteId);
  if (!site) {
    throw siteNotFound();
  }
  if (site.state === "DELISTED") {
    throw siteDelisted();
  }
  if (site.state === "LISTED") {
    return site;
  }

  await client.query(
    `UPDATE sites
     SET state = 'LISTED',
         listed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [siteId],
  );

  const updated = await getSiteById(client, siteId);
  if (!updated) {
    throw siteNotFound();
  }
  return updated;
}

export async function adminDelistSite(client: PoolClient, siteId: string): Promise<void> {
  const site = await getSiteById(client, siteId);
  if (!site) {
    throw siteNotFound();
  }
  if (site.state === "DELISTED") {
    return;
  }

  await client.query(
    `UPDATE sites
     SET state = 'DELISTED',
         token_hash = NULL,
         delisted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [siteId],
  );
}
