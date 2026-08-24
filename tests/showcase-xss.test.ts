import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { createSiteCardElement } from "../showcase/sites.js";

describe("createSiteCardElement XSS safety", () => {
  it("renders hostile displayName as text, not HTML", () => {
    const { document } = parseHTML("<!doctype html><html><body></body></html>");

    const card = createSiteCardElement(
      {
        siteId: "00000000-0000-4000-8000-000000000001",
        displayName: '<img src=x onerror="alert(1)">',
        canonicalUrl: "https://safe.example",
        packages: {
          "@thierry-gilgen-ict/engawa-core": "0.1.1",
        },
        listedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      document,
    );

    const title = card.querySelector(".site-card__title");
    expect(title?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(title?.innerHTML).toBe('&lt;img src=x onerror="alert(1)"&gt;');
    expect(card.querySelector("img")).toBeNull();
  });
});
