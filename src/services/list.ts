import type { Pool, PoolClient } from "pg";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants.js";
import { decodeListCursor, encodeListCursor } from "../schemas/cursor.js";
import { mapPublicListItem, type SiteRow } from "./sites.js";

export async function listListedSites(
  db: Pool | PoolClient,
  input: { limit?: number; cursor?: string },
): Promise<{ items: ReturnType<typeof mapPublicListItem>[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

  const params: unknown[] = [];
  let where = "WHERE state = 'LISTED'";

  if (input.cursor) {
    const decoded = decodeListCursor(input.cursor);
    const listedAtParam = params.length + 1;
    params.push(decoded.listedAt);
    const siteIdParam = params.length + 1;
    params.push(decoded.siteId);
    where += ` AND (date_trunc('milliseconds', listed_at), id) > (date_trunc('milliseconds', $${listedAtParam}::timestamptz), $${siteIdParam}::uuid)`;
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
      nextCursor = encodeListCursor({
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
