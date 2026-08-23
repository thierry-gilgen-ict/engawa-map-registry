// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateAndNormalizeCanonicalUrl } from "../src/schemas/canonical-url.js";

describe("canonical URL validation", () => {
  it("normalizes https origins", () => {
    expect(validateAndNormalizeCanonicalUrl("https://Example.COM/")).toBe("https://example.com");
  });

  it("rejects localhost", () => {
    expect(() => validateAndNormalizeCanonicalUrl("https://localhost")).toThrow();
  });
});
