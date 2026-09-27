import { describe, it, expect } from "vitest";
import { matchExternalPackage, lookupExternalPackage } from "./infraPackages";

describe("matchExternalPackage", () => {
  it("matches a bare package import", () => {
    expect(matchExternalPackage("mysql2")).toEqual({ id: "mysql2", name: "MySQL", category: "database" });
    expect(matchExternalPackage("redis")).toEqual({ id: "redis", name: "Redis", category: "cache" });
  });

  it("strips a subpath down to the package root", () => {
    expect(matchExternalPackage("mysql2/promise")).toMatchObject({ id: "mysql2", name: "MySQL" });
  });

  it("keeps the scope for a scoped package and strips subpaths after it", () => {
    expect(matchExternalPackage("@elastic/elasticsearch/lib/Client")).toMatchObject({ id: "@elastic/elasticsearch", name: "Elasticsearch" });
    expect(matchExternalPackage("@nestjs/core")).toMatchObject({ id: "@nestjs/core", name: "NestJS", category: "backend" });
  });

  it("returns null for an unknown package — never guesses", () => {
    expect(matchExternalPackage("lodash")).toBeNull();
    expect(matchExternalPackage("axios")).toBeNull();
  });
});

describe("lookupExternalPackage", () => {
  it("resolves a canonical id back to its display info", () => {
    expect(lookupExternalPackage("mysql2")).toEqual({ name: "MySQL", category: "database" });
    expect(lookupExternalPackage("no-such-package")).toBeNull();
  });
});
