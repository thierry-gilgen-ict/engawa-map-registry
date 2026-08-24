import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("showcase nginx privacy route", () => {
  it("serves /privacy directly without redirect", () => {
    const conf = readFileSync("showcase/nginx.conf", "utf8");
    expect(conf).not.toContain("return 301 /privacy.html");
    expect(conf).toMatch(/location = \/privacy/);
    expect(conf).toMatch(/try_files \/privacy\.html/);
  });
});
