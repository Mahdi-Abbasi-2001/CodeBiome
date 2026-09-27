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

  it("counts a framework's evidence files PER DOMAIN, not just whether it's present there at all", async () => {
    // A backend domain that server-side-renders its frontend framework has
    // real evidence for both — but overwhelmingly for the backend one.
    // `domainIds` alone can't tell "one SSR import" apart from "an entire
    // backend framework's worth of files"; `domainFileCounts` can.
    const model = await buildTestKnowledgeModel({
      "server/express.js": `import express from 'express'\nimport React from 'react'\nexport const app = express()\n`,
      "server/routes/order.routes.js": `import express from 'express'\nexport const router = express.Router()\n`,
      "server/routes/user.routes.js": `import express from 'express'\nexport const router = express.Router()\n`,
      "client/App.js": `import React from 'react'\nexport const App = () => null\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const nodes = computeInfrastructureNodes(model, domains);

    const react = nodes.find((n) => n.name === "React")!;
    const express = nodes.find((n) => n.name === "Express")!;
    const serverDomain = domains.find((d) => d.name === "server")!;
    const clientDomain = domains.find((d) => d.name === "client")!;

    expect(react.domainIds.sort()).toEqual([clientDomain.id, serverDomain.id].sort());
    expect(react.domainFileCounts[serverDomain.id]).toBe(1);
    expect(react.domainFileCounts[clientDomain.id]).toBe(1);
    expect(express.domainFileCounts[serverDomain.id]).toBe(3);
    expect(express.domainFileCounts[serverDomain.id]).toBeGreaterThan(react.domainFileCounts[serverDomain.id]);
  });

  it("returns nothing for a repository with no detected technology — never fabricates a node", async () => {
    const model = await buildTestKnowledgeModel({ "src/index.ts": `export const x = 1;\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    expect(computeInfrastructureNodes(model, domains)).toEqual([]);
  });
});
