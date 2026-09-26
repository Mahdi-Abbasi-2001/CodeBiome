import { describe, it, expect } from "vitest";
import { computeDomainSequence, buildingForFile } from "./sequenceLayout";
import { computeDomains } from "./domains";
import { buildWorldModel } from "@/server/world/builder";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

describe("computeDomainSequence", () => {
  it("places the registration chain in role order along the avenue, with wiring files excluded", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/user.service.ts": `export class UserService {}\n`,
      "user/user.entity.ts": `export class UserEntity {}\n`,
      "user/user.module.ts": `export class UserModule {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);

    expect(sequence.isGeneric).toBe(false);
    // user.module.ts is pure wiring — never becomes its own building.
    expect(sequence.buildings.some((b) => b.path.endsWith("user.module.ts"))).toBe(false);

    const controller = sequence.buildings.find((b) => b.role === "controller")!;
    const service = sequence.buildings.find((b) => b.role === "service")!;
    const entity = sequence.buildings.find((b) => b.role === "entity")!;
    expect(controller.position[0]).toBeLessThan(service.position[0]);
    expect(service.position[0]).toBeLessThan(entity.position[0]);
    // All three sit on the same main-sequence line (grade), well spaced apart.
    expect(controller.onMainSequence).toBe(true);
    expect(service.position[0] - controller.position[0]).toBeGreaterThan(3);
  });

  it("drops repository/database roles to a lower elevation behind a real yard", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/user.repository.ts": `export class UserRepository {}\n`,
      "user/database.ts": `export const db = 1;\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);

    const repo = sequence.buildings.find((b) => b.role === "repository")!;
    const db = sequence.buildings.find((b) => b.role === "database")!;
    expect(repo.position[1]).toBeLessThan(0);
    expect(db.position[1]).toBeLessThan(0);
    expect(sequence.yard).not.toBeNull();
    expect(sequence.yard!.drop).toBeGreaterThan(0);
  });

  it("branches middleware off the avenue instead of placing it on the main chain", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/user.service.ts": `export class UserService {}\n`,
      "user/auth.middleware.ts": `export class AuthMiddleware {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);

    const middleware = sequence.buildings.find((b) => b.role === "middleware")!;
    expect(middleware.onMainSequence).toBe(false);
    // Off the avenue's own Z=0 line, not on it.
    expect(Math.abs(middleware.position[2])).toBeGreaterThan(1);
  });

  it("falls back to isGeneric when a domain has no recognizable architectural role at all", async () => {
    const model = await buildTestKnowledgeModel({ "shared/helpers.ts": `export const noop = () => {};\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const shared = domains.find((d) => d.name === "shared")!;
    const sequence = computeDomainSequence(shared, model);
    expect(sequence.isGeneric).toBe(true);
    expect(sequence.buildings).toHaveLength(0);
  });

  it("spreads two files of the same role laterally instead of overlapping", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/admin.controller.ts": `export class AdminController {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);
    const controllers = sequence.buildings.filter((b) => b.role === "controller");
    expect(controllers).toHaveLength(2);
    expect(controllers[0].position[2]).not.toBe(controllers[1].position[2]);
    expect(controllers[0].position[0]).toBe(controllers[1].position[0]);
  });

  it("centers the plaza on the hub, sized to contain every at-grade building", async () => {
    const model = await buildTestKnowledgeModel({
      "user/user.controller.ts": `export class UserController {}\n`,
      "user/user.service.ts": `export class UserService {}\n`,
      "user/user.entity.ts": `export class UserEntity {}\n`,
    });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);
    const hub = sequence.buildings.find((b) => b.role === "service")!;

    expect(sequence.plaza).not.toBeNull();
    expect(sequence.plaza!.center[0]).toBe(hub.position[0]);
    const entity = sequence.buildings.find((b) => b.role === "entity")!;
    expect(sequence.plaza!.center[0] + sequence.plaza!.radius).toBeGreaterThanOrEqual(entity.position[0]);
  });

  it("buildingForFile resolves a real file id back to its placed building", async () => {
    const model = await buildTestKnowledgeModel({ "user/user.controller.ts": `export class UserController {}\n` });
    const world = buildWorldModel(model);
    const domains = computeDomains(world, model);
    const user = domains.find((d) => d.name === "user")!;
    const sequence = computeDomainSequence(user, model);
    const fileId = sequence.buildings[0].fileId;
    expect(buildingForFile(sequence, fileId)?.fileId).toBe(fileId);
    expect(buildingForFile(sequence, "no-such-file")).toBeNull();
  });
});
