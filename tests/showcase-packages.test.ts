import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { createSiteCardElement } from "../showcase/sites.js";

describe("createSiteCardElement package versions", () => {
  it("renders all present Engawa packages in deterministic order", () => {
    const { document } = parseHTML("<!doctype html><html><body></body></html>");

    const card = createSiteCardElement(
      {
        siteId: "00000000-0000-4000-8000-000000000001",
        displayName: "Full Stack Site",
        canonicalUrl: "https://example.com",
        packages: {
          "@thierry-gilgen-ict/engawa-core": "0.1.1",
          "@thierry-gilgen-ict/engawa-discovery": "0.1.1",
          "@thierry-gilgen-ict/engawa-mcp": "0.1.1",
          "@thierry-gilgen-ict/engawa-react": "0.1.0",
        },
        listedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      document,
    );

    const labels = [...card.querySelectorAll("dt")].map((dt) => dt.textContent);
    const versions = [...card.querySelectorAll("dd")].map((dd) => dd.textContent);

    expect(labels).toEqual(["Engawa core", "Engawa discovery", "Engawa MCP", "Engawa React"]);
    expect(versions).toEqual(["0.1.1", "0.1.1", "0.1.1", "0.1.0"]);
  });
});
