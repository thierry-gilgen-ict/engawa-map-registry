import { describe, expect, it } from "vitest";
import { filterSites } from "../showcase/sites.js";

const sampleSite = (overrides: Record<string, unknown> = {}) => ({
  siteId: "00000000-0000-4000-8000-000000000001",
  displayName: "Example Site",
  canonicalUrl: "https://example.com",
  packages: {
    "@thierry-gilgen-ict/engawa-core": "0.1.1",
  },
  listedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("filterSites", () => {
  const sites = [
    sampleSite({
      displayName: "Alpha Docs",
      hints: { framework: "next", byaEnabled: true },
    }),
    sampleSite({
      siteId: "00000000-0000-4000-8000-000000000002",
      displayName: "Beta Guide",
      hints: { framework: "astro", byaEnabled: false },
    }),
    sampleSite({
      siteId: "00000000-0000-4000-8000-000000000003",
      displayName: "Gamma Notes",
      hints: { framework: "next" },
    }),
  ];

  it("filters displayName case-insensitively", () => {
    const result = filterSites(sites, { search: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0]?.displayName).toBe("Alpha Docs");
  });

  it("filters by framework hint", () => {
    const result = filterSites(sites, { framework: "astro" });
    expect(result).toHaveLength(1);
    expect(result[0]?.displayName).toBe("Beta Guide");
  });

  it("treats BYA No as byaEnabled === false only", () => {
    const result = filterSites(sites, { byaFilter: "no" });
    expect(result.map((site) => site.displayName)).toEqual(["Beta Guide"]);
  });

  it("treats undefined byaEnabled as not matching BYA No", () => {
    const result = filterSites(sites, { byaFilter: "no" });
    expect(result.some((site) => site.displayName === "Gamma Notes")).toBe(false);
  });

  it("filters BYA Yes to explicit true only", () => {
    const result = filterSites(sites, { byaFilter: "yes" });
    expect(result.map((site) => site.displayName)).toEqual(["Alpha Docs"]);
  });
});

describe("fetchAllListedSites pagination merge", () => {
  it("merges items across pages until nextCursor is null", async () => {
    const { fetchAllListedSites } = await import("../showcase/sites.js");

    const pages = new Map<string | null, { items: unknown[]; nextCursor: string | null }>([
      [
        null,
        {
          items: [sampleSite({ displayName: "Page One" })],
          nextCursor: "cursor-2",
        },
      ],
      [
        "cursor-2",
        {
          items: [
            sampleSite({
              siteId: "00000000-0000-4000-8000-000000000099",
              displayName: "Page Two",
            }),
          ],
          nextCursor: null,
        },
      ],
    ]);

    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("cursor");
      const page = pages.get(cursor);
      if (!page) {
        throw new Error(`unexpected cursor: ${cursor}`);
      }
      return new Response(JSON.stringify(page), { status: 200 });
    };

    const result = await fetchAllListedSites(fetchFn, "https://map.example");
    expect(result).toHaveLength(2);
    expect(result.map((site) => site.displayName)).toEqual(["Page One", "Page Two"]);
  });
});
