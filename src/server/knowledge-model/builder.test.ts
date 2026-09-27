import { describe, it, expect } from "vitest";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

describe("buildKnowledgeModel — repository.frameworks", () => {
  it("detects real infrastructure and framework dependencies from actual source imports, never fabricating one that isn't there", async () => {
    const model = await buildTestKnowledgeModel({
      "src/app.module.ts": `import { Module } from '@nestjs/core';\n@Module({}) export class AppModule {}\n`,
      "src/user/user.service.ts": `import { getRepository } from 'typeorm';\nexport class UserService {}\n`,
      "src/cache/cache.service.ts": `import Redis from 'ioredis';\nexport class CacheService {}\n`,
      "src/util/format.ts": `import { z } from 'zod';\nexport const x = z;\n`,
    });

    const names = model.repository.frameworks.map((f) => f.name).sort();
    expect(names).toEqual(["NestJS", "Redis", "TypeORM"]);
    expect(model.repository.frameworks.find((f) => f.name === "NestJS")?.category).toBe("backend");
    expect(model.repository.frameworks.find((f) => f.name === "Redis")?.category).toBe("cache");
    expect(model.repository.frameworks.find((f) => f.name === "TypeORM")?.category).toBe("database");
    // "zod" isn't a known technology — must never appear as a fabricated detection
    expect(names).not.toContain("zod");
  });

  it("merges two packages that name the same real technology into one detection", async () => {
    const model = await buildTestKnowledgeModel({
      "src/a.ts": `import mysql from 'mysql';\n`,
      "src/b.ts": `import mysql2 from 'mysql2';\n`,
    });
    const mysqlDetections = model.repository.frameworks.filter((f) => f.name === "MySQL");
    expect(mysqlDetections).toHaveLength(1);
    expect(mysqlDetections[0].evidence.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns no frameworks for a repository with no recognizable technology imports", async () => {
    const model = await buildTestKnowledgeModel({ "src/index.ts": `export const x = 1;\n` });
    expect(model.repository.frameworks).toEqual([]);
  });
});
