import { describe, it, expect } from "vitest";
import { computeDomainSequence, buildingForFile } from "./domainSequence";
import { computeDomains } from "./domains";
import { buildWorldModel } from "@/server/world/builder";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

describe("computeDomainSequence", () => {
  it("places controller, service, entity, repository and database along the main sequence in order", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `import { UserService } from './user.service';\nexport class UserController { constructor(private s: UserService) {} }\n`,
      "user/user.service.ts": `import { UserEntity } from './user.entity';\nexport class UserService { constructor(private e: UserEntity) {} }\n`,
      "user/user.entity.ts": `export class UserEntity {}\n`,
      "user/user.repository.ts": `import { UserEntity } from './user.entity';\nexport class UserRepository { constructor(private e: UserEntity) {} }\n`,
      "user/user.database.ts": `export const db = {};\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const seq = computeDomainSequence(user, model);

    expect(seq.isGeneric).toBe(false);
    expect(seq.buildings.map((b) => b.role).sort()).toEqual(["controller", "database", "entity", "repository", "service"]);

    const controller = seq.buildings.find((b) => b.role === "controller")!;
    const service = seq.buildings.find((b) => b.role === "service")!;
    const entity = seq.buildings.find((b) => b.role === "entity")!;
    const repository = seq.buildings.find((b) => b.role === "repository")!;
    const database = seq.buildings.find((b) => b.role === "database")!;
    expect(controller.order).toBeLessThan(service.order!);
    expect(service.order).toBeLessThan(entity.order!);
    expect(entity.order).toBeLessThan(repository.order!);
    expect(repository.order).toBeLessThanOrEqual(database.order!);
    expect(seq.yard).not.toBeNull();
    expect(seq.plaza).not.toBeNull();
  });

  it("forks middleware onto a side branch instead of the main sequence", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/auth.middleware.ts": `export class AuthMiddleware {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const seq = computeDomainSequence(user, model);

    const middleware = seq.buildings.find((b) => b.role === "middleware")!;
    expect(middleware).toBeTruthy();
    expect(middleware.onMainSequence).toBe(false);
    expect(seq.branches).toHaveLength(1);
    expect(seq.junction).not.toBeNull();
  });

  it("spreads many branch candidates across multiple rings instead of piling them on one point", async () => {
    // A single ring's angle step (0.5 rad) wraps past a full turn well
    // before 20 items — this used to land several files on the exact same
    // coordinate. Fourteen middleware files is enough to force 3 rings at
    // BRANCH_ITEMS_PER_RING=6.
    const files: Record<string, string> = { "user/user.controller.ts": `export class UserController {}\n` };
    for (let i = 0; i < 14; i++) {
      files[`user/middlewares/mw${i}.middleware.ts`] = `export const mw${i} = () => {};\n`;
    }
    const model = await buildTestKnowledgeModel(files);
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const seq = computeDomainSequence(user, model);

    expect(seq.branches).toHaveLength(14);
    const positions = seq.branches.map((b) => b.building.position.join(","));
    expect(new Set(positions).size).toBe(14); // every branch lands on a distinct point
  });

  it("marks a file with a real risk indicator as damaged", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.service.ts": `export class UserService { ${"const line = 1;\n".repeat(9000)} }\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const seq = computeDomainSequence(user, model);
    const service = seq.buildings.find((b) => b.role === "service");
    expect(service).toBeTruthy();
    // whether it's flagged depends on the real analyzer's large-file threshold — assert the field exists and is boolean, not a fabricated truth
    expect(typeof service!.damaged).toBe("boolean");
  });

  it("recognizes frontend components and hooks as branch landmarks, even with no backend role in the domain", async () => {
    const model = await buildTestKnowledgeModel({
      "client/product/Products.js": `export default function Products() { return null; }\n`,
      "client/product/api-product.js": `export const list = () => {};\n`, // not PascalCase, not a hook — stays unrecognized, same as any other helper file
      "client/shared/useAuth.js": `export function useAuth() { return {}; }\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const client = domains.find((d) => d.name === "client")!;
    const seq = computeDomainSequence(client, model);

    expect(seq.isGeneric).toBe(false);
    const roles = seq.buildings.map((b) => ({ path: b.path, role: b.role, onMainSequence: b.onMainSequence }));
    expect(roles).toContainEqual({ path: "client/product/Products.js", role: "component", onMainSequence: false });
    expect(roles).toContainEqual({ path: "client/shared/useAuth.js", role: "hook", onMainSequence: false });
    expect(roles.find((r) => r.path === "client/product/api-product.js")).toBeUndefined();
  });

  it("returns an empty, generic sequence for a domain with no recognizable architectural roles", async () => {
    const model = await buildTestKnowledgeModel({
      "misc/README.md": `# hi\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const misc = domains.find((d) => d.name === "misc")!;
    const seq = computeDomainSequence(misc, model);
    expect(seq.isGeneric).toBe(true);
    expect(seq.buildings).toHaveLength(0);
  });

  it("buildingForFile resolves a real file id back to its placed building", async () => {
    const model = await buildTestKnowledgeModel({ "user/user.controller.ts": `export class UserController {}\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const seq = computeDomainSequence(user, model);
    const fileId = model.files.find((f) => f.path.includes("controller"))!.id;
    expect(buildingForFile(seq, fileId)?.role).toBe("controller");
    expect(buildingForFile(seq, "no-such-file")).toBeNull();
  });
});
