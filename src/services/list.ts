import type { Pool, PoolClient } from "pg";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants.js";
import { invalidRequest } from "../errors.js";
import { mapPublicListItem, type SiteRow } from "./sites.js";

interface ListCursor {
  listedAt: string;
  siteId: string;
}

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ListCursor;
    if (!parsed.listedAt || !parsed.siteId) {
      throw new Error("invalid cursor");
    }
    return parsed;
  } catch {
    throw invalidRequest("Invalid pagination cursor.");
  }
}

export async function listListedSites(
  db: Pool | PoolClient,
  input: { limit?: number; cursor?: string },
): Promise<{ items: ReturnType<typeof mapPublicListItem>[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

  const params: unknown[] = [];
  let where = "WHERE state = 'LISTED'";

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    params.push(decoded.listedAt, decoded.siteId);
    where += ` AND (listed_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  params.push(limit + 1);
  const sql = `
    SELECT *
    FROM sites
    ${where}
    ORDER BY listed_at ASC, id ASC
    LIMIT $${params.length}
  `;

  const result = await db.query<SiteRow>(sql, params);
  const rows = result.rows;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last?.listed_at) {
      nextCursor = encodeCursor({
        listedAt: last.listed_at.toISOString(),
        siteId: last.id,
      });
    }
  }

  return {
    items: page.map(mapPublicListItem),
    nextCursor,
  };
}
