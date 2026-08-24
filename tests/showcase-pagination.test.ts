import { describe, expect, it } from "vitest";
import { fetchAllListedSites } from "../showcase/sites.js";

const site = (displayName: string) => ({
  siteId: "00000000-0000-4000-8000-000000000001",
  displayName,
  canonicalUrl: "https://example.com",
  packages: {
    "@thierry-gilgen-ict/engawa-core": "0.1.1",
  },
  listedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("fetchAllListedSites two-page cursor", () => {
  it("requests limit=100 and follows nextCursor once", async () => {
    const requests: string[] = [];

    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.search);

      if (!url.searchParams.has("cursor")) {
        return new Response(
          JSON.stringify({
            items: [site("First page")],
            nextCursor: "page-2",
          }),
          { status: 200 },
        );
      }

      expect(url.searchParams.get("cursor")).toBe("page-2");
      expect(url.searchParams.get("limit")).toBe("100");

      return new Response(
        JSON.stringify({
          items: [site("Second page")],
          nextCursor: null,
        }),
        { status: 200 },
      );
    };

    const result = await fetchAllListedSites(fetchFn, "https://map.example");
    expect(requests).toEqual(["?limit=100", "?limit=100&cursor=page-2"]);
    expect(result.map((entry) => entry.displayName)).toEqual(["First page", "Second page"]);
  });
});
