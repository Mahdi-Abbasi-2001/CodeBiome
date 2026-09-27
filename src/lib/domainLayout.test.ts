import { describe, it, expect } from "vitest";
import { layoutDomains, isolatedDomainIds, gatePosition } from "./domainLayout";
import type { Domain } from "./domains";

function fakeDomain(id: string, footprint = 3): Domain {
  return { id, name: id, moduleIds: [id], regionIds: [`region-${id}`], isInfra: false, healthTier: "healthy", hasRisk: false, footprint, height: 1 };
}

describe("layoutDomains", () => {
  it("places the first (most important) domain at the origin and is deterministic across calls", () => {
    const domains = [fakeDomain("a"), fakeDomain("b"), fakeDomain("c")];
    const positions = layoutDomains(domains);
    expect(positions.get("a")).toEqual([0, 0]);

    const again = layoutDomains(domains);
    expect(again.get("b")).toEqual(positions.get("b"));
    expect(again.get("c")).toEqual(positions.get("c"));
  });

  it("spreads domains further apart as bigger footprints join the layout", () => {
    const small = layoutDomains([fakeDomain("a", 2), fakeDomain("b", 2)]);
    const big = layoutDomains([fakeDomain("a", 40), fakeDomain("b", 40)]);
    const dist = (p: Map<string, [number, number]>) => {
      const [ax, ay] = p.get("a")!;
      const [bx, by] = p.get("b")!;
      return Math.hypot(ax - bx, ay - by);
    };
    expect(dist(big)).toBeGreaterThan(dist(small));
  });
});

describe("isolatedDomainIds", () => {
  it("flags a domain with no connection to anything as isolated", () => {
    const domains = [fakeDomain("hub"), fakeDomain("peer"), fakeDomain("cutoff")];
    const connected = new Set(["hub", "peer"]);
    const isolated = isolatedDomainIds(domains, connected);
    expect(isolated.has("cutoff")).toBe(true);
    expect(isolated.has("hub")).toBe(false);
    expect(isolated.has("peer")).toBe(false);
  });

  it("never flags anything isolated for a single-domain repository", () => {
    const isolated = isolatedDomainIds([fakeDomain("only")], new Set());
    expect(isolated.size).toBe(0);
  });
});

describe("gatePosition", () => {
  it("sits further out than every domain", () => {
    const domains = [fakeDomain("a"), fakeDomain("b"), fakeDomain("c")];
    const positions = layoutDomains(domains);
    const [gx, gy] = gatePosition(positions);
    const gateDist = Math.hypot(gx, gy);
    for (const [x, y] of positions.values()) {
      expect(gateDist).toBeGreaterThan(Math.hypot(x, y));
    }
  });
});
