// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  validateAndNormalizeCanonicalUrl,
  CanonicalUrlError,
} from "../src/schemas/canonical-url.js";

describe("canonical URL validation", () => {
  it("normalizes https origins", () => {
    expect(validateAndNormalizeCanonicalUrl("https://Example.COM/")).toBe("https://example.com");
  });

  it("accepts ordinary DNS hostnames without misclassifying them as IPv6", () => {
    for (const url of [
      "https://example.com",
      "https://www.example.com",
      "https://staging.example.com",
      "https://z.example.com",
      "https://staging-e2e-123.example.com",
    ]) {
      expect(validateAndNormalizeCanonicalUrl(url)).toBe(url);
    }
  });

  it("accepts a public IPv6 literal", () => {
    expect(validateAndNormalizeCanonicalUrl("https://[2001:4860:4860::8888]")).toBe(
      "https://[2001:4860:4860::8888]",
    );
  });

  it("rejects localhost", () => {
    expect(() => validateAndNormalizeCanonicalUrl("https://localhost")).toThrow(CanonicalUrlError);
    expect(() => validateAndNormalizeCanonicalUrl("https://foo.localhost")).toThrow(
      CanonicalUrlError,
    );
  });

  it("rejects .local hostnames", () => {
    expect(() => validateAndNormalizeCanonicalUrl("https://app.local")).toThrow(CanonicalUrlError);
  });

  it("rejects private IPv4 literals", () => {
    for (const url of [
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://172.16.0.1",
      "https://192.168.1.1",
      "https://169.254.1.1",
    ]) {
      expect(() => validateAndNormalizeCanonicalUrl(url)).toThrow(CanonicalUrlError);
    }
  });

  it("rejects private and reserved IPv6 literals", () => {
    for (const url of [
      "https://[::1]",
      "https://[fc00::1]",
      "https://[fd00::1]",
      "https://[fe80::1]",
    ]) {
      expect(() => validateAndNormalizeCanonicalUrl(url)).toThrow(CanonicalUrlError);
    }
  });
});
