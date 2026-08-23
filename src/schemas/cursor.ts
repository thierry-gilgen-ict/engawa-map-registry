import { z } from "zod";
import { invalidRequest } from "../errors.js";

export const MAX_CURSOR_LENGTH = 2048;

export const listCursorSchema = z
  .object({
    listedAt: z.string().datetime(),
    siteId: z.string().uuid(),
  })
  .strict();

export type ListCursor = z.infer<typeof listCursorSchema>;

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeListCursor(raw: string): ListCursor {
  if (raw.length > MAX_CURSOR_LENGTH) {
    throw invalidRequest("Invalid pagination cursor.");
  }

  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return listCursorSchema.parse(parsed);
  } catch {
    throw invalidRequest("Invalid pagination cursor.");
  }
}
