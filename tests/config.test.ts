// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
      }),
    ).toThrow(/DATABASE_URL is required/);
  });

  it("accepts a valid DATABASE_URL", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    });
    expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
  });

  it("defaults TRUST_PROXY_HOPS to 0", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    });
    expect(config.TRUST_PROXY_HOPS).toBe(0);
  });

  it("parses TRUST_PROXY_HOPS within 0-8", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      TRUST_PROXY_HOPS: "1",
    });
    expect(config.TRUST_PROXY_HOPS).toBe(1);
  });

  it("rejects TRUST_PROXY_HOPS above 8", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        TRUST_PROXY_HOPS: "9",
      }),
    ).toThrow(/Invalid configuration/);
  });

  it("rejects negative TRUST_PROXY_HOPS", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        TRUST_PROXY_HOPS: "-1",
      }),
    ).toThrow(/Invalid configuration/);
  });
});
