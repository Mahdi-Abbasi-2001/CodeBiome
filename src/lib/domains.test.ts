import { describe, it, expect } from "vitest";
import { computeDomains, computeDomainBridges, domainForModule } from "./domains";
import { buildWorldModel } from "@/server/world/builder";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

describe("computeDomains", () => {
  it("gives a flat, src/-only repository one single-module Domain per module — the demo repository's actual shape", async () => {
    const model = await buildTestKnowledgeModel({
      "src/user/user.controller.ts": `export class UserController {}\n`,
      "src/article/article.controller.ts": `export class ArticleController {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);

    const names = domains.map((d) => d.name).sort();
    expect(names).toEqual(["article", "user"]);
    for (const d of domains) expect(d.moduleIds).toHaveLength(1);
  });

  it("groups modules that share a real, non-generic directory prefix into one multi-module Domain", async () => {
    const model = await buildTestKnowledgeModel({
      "billing/invoices/invoice.ts": `export const invoice = 1;\n`,
      "billing/payments/payment.ts": `export const payment = 1;\n`,
      "search/index.ts": `export const search = 1;\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);

    const billing = domains.find((d) => d.name === "billing");
    expect(billing).toBeTruthy();
    expect(billing!.moduleIds.length).toBeGreaterThanOrEqual(2);

    const search = domains.find((d) => d.name === "search");
    expect(search).toBeTruthy();
    expect(search!.moduleIds).not.toEqual(expect.arrayContaining(billing!.moduleIds));
  });

  it("marks a domain infrastructure only when EVERY member module is a test/docs landmark", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "tests/user.spec.ts": `describe('user', () => { it('works', () => {}); });\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);

    const userDomain = domains.find((d) => d.name === "user");
    const testsDomain = domains.find((d) => d.name === "tests");
    expect(userDomain?.isInfra).toBe(false);
    expect(testsDomain?.isInfra).toBe(true);
  });

  it("domainForModule resolves a real module id back to its Domain", async () => {
    const model = await buildTestKnowledgeModel({ "src/user/index.ts": `export const x = 1;\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const moduleId = model.modules[0].id;
    expect(domainForModule(domains, moduleId)?.moduleIds).toContain(moduleId);
    expect(domainForModule(domains, "no-such-module")).toBeNull();
  });
});

describe("computeDomainBridges", () => {
  it("aggregates real cross-domain file dependencies into one bridge per domain pair, and flags a cyclic one", async () => {
    const model = await buildTestKnowledgeModel({
      "src/user/user.service.ts": `import { ArticleService } from '../article/article.service';\nexport class UserService { constructor(private a: ArticleService) {} }\n`,
      "src/article/article.service.ts": `import { UserService } from '../user/user.service';\nexport class ArticleService { constructor(private u: UserService) {} }\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const bridges = computeDomainBridges(domains, model);

    expect(bridges).toHaveLength(1);
    expect(bridges[0].cyclic).toBe(true);
    expect(bridges[0].weight).toBeGreaterThan(0);
  });

  it("renders module-level dependency submissions as World paths and domain bridges", async () => {
    const model = await buildTestKnowledgeModel({
      "src/api/controller.ts": `export const controller = true;\n`,
      "src/core/service.ts": `export const service = true;\n`,
    });
    const apiModule = model.modules.find((module) => module.path === "src/api")!;
    const coreModule = model.modules.find((module) => module.path === "src/core")!;
    model.dependencies = [{
      id: "module-edge",
      fromId: apiModule.id,
      toId: coreModule.id,
      fromKind: "module",
      toKind: "module",
      relationship: "calls",
      direction: "uses",
      confidence: 0.9,
    }];

    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);

    expect(world.paths).toHaveLength(1);
    expect(computeDomainBridges(domains, model)).toHaveLength(1);
  });

  it("keeps bridges rare — weak, incidental cross-domain references don't each get their own bridge", async () => {
    const files: Record<string, string> = {
      "hub/hub.service.ts": `export class HubService {}\n`,
      "core/core.service.ts": `import { HubService } from '../hub/hub.service';\nexport class CoreService { constructor(private h: HubService) {} }\n`,
      "core/core.other.ts": `import { HubService } from '../hub/hub.service';\nexport class CoreOther { constructor(private h: HubService) {} }\n`,
    };
    for (let i = 0; i < 10; i++) {
      files[`peer${i}/peer${i}.service.ts`] = `import { HubService } from '../hub/hub.service';\nexport class Peer${i}Service { constructor(private h: HubService) {} }\n`;
    }
    const model = await buildTestKnowledgeModel(files);
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const bridges = computeDomainBridges(domains, model);

    expect(bridges.length).toBeLessThanOrEqual(5);
    const survivingIds = new Set(bridges.flatMap((b) => [b.fromDomainId, b.toDomainId]));
    expect(survivingIds.has("domain-core")).toBe(true);
  });

  it("never bridges two modules inside the SAME domain", async () => {
    const model = await buildTestKnowledgeModel({
      "billing/invoices/invoice.ts": `import { payment } from '../payments/payment';\nexport const invoice = payment;\n`,
      "billing/payments/payment.ts": `export const payment = 1;\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const bridges = computeDomainBridges(domains, model);
    expect(bridges).toHaveLength(0);
  });
});
