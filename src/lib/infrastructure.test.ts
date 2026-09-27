import { describe, it, expect } from "vitest";
import { computeInfrastructureNodes } from "./infrastructure";
import { computeDomains } from "./domains";
import { buildWorldModel } from "@/server/world/builder";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

describe("computeInfrastructureNodes", () => {
  it("builds a real node for each detected technology, linked to the real domain that uses it", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.service.ts": `import { getRepository } from 'typeorm';\nexport class UserService {}\n`,
      "order/order.cache.ts": `import Redis from 'ioredis';\nexport class OrderCache {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const nodes = computeInfrastructureNodes(model, domains);

    const typeorm = nodes.find((n) => n.name === "TypeORM")!;
    const redis = nodes.find((n) => n.name === "Redis")!;
    expect(typeorm.category).toBe("database");
    expect(redis.category).toBe("cache");

    const userDomain = domains.find((d) => d.name === "user")!;
    const orderDomain = domains.find((d) => d.name === "order")!;
    expect(typeorm.domainIds).toEqual([userDomain.id]);
    expect(redis.domainIds).toEqual([orderDomain.id]);
  });

  it("returns nothing for a repository with no detected technology — never fabricates a node", async () => {
    const model = await buildTestKnowledgeModel({ "src/index.ts": `export const x = 1;\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    expect(computeInfrastructureNodes(model, domains)).toEqual([]);
  });
});
