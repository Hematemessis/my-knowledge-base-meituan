import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";

import { PostgresMemoryRepository } from "./postgres-repository";
import { DEMO_PROJECT_ID } from "./types";

const execFileAsync = promisify(execFile);
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
let adminSql: ReturnType<typeof postgres> | null = null;

describeWithDatabase("PostgreSQL memory lifecycle", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    const databaseName = new URL(testDatabaseUrl).pathname.toLowerCase();
    if (!databaseName.includes("test")) {
      throw new Error("TEST_DATABASE_URL 必须指向名称包含 test 的专用测试数据库");
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    await execFileAsync(process.execPath, [resolve("scripts/migrate.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    });
    adminSql = postgres(testDatabaseUrl, { max: 1 });
  });

  beforeEach(async () => {
    if (!adminSql) return;
    await adminSql`DELETE FROM projects WHERE id = ${DEMO_PROJECT_ID}`;
    await adminSql`
      INSERT INTO projects (id, title, description)
      VALUES (${DEMO_PROJECT_ID}, 'M1 integration test', 'Disposable test project')
    `;
  });

  afterAll(async () => {
    await closeDatabase();
    if (adminSql) await adminSql.end({ timeout: 5 });
  });

  it("persists editable reviews, compensating undo, and version restore", async () => {
    const repository = new PostgresMemoryRepository();
    const original = await repository.captureConfirmedMemory({
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "产品范围",
      statement: "产品优先保证功能完整度。",
      importance: 90,
    });
    const captured = await repository.captureMemoryCandidates({
      projectId: DEMO_PROJECT_ID,
      sourceText: "我们决定补充数据可迁移要求。",
      extractor: "heuristic",
      candidates: [
        {
          scope: "project",
          type: "decision",
          subject: "产品范围",
          statement: "产品优先保证功能完整度和数据可迁移性。",
          confidence: 0.9,
          importance: 94,
        },
      ],
    });

    const reviewed = await repository.reviewMemoryCandidate({
      candidateId: captured.candidates[0].id,
      action: "merge",
      targetMemoryId: original.memory.id,
      reason: "补充退出标准",
      patch: {
        statement: "产品优先保证完整度，并确保数据可以迁移。",
        importance: 97,
      },
    });
    expect(reviewed.memory?.statement).toContain("数据可以迁移");
    expect(reviewed.candidate.resultVersion).toBe(2);

    const undone = await repository.undoMemoryCandidateReview(
      captured.candidates[0].id,
      "集成测试撤销",
    );
    expect(undone.candidate.status).toBe("pending");
    expect(undone.memory?.statement).toBe("产品优先保证功能完整度。");
    expect((await repository.listMemoryVersions(original.memory.id))[0].version).toBe(3);

    const restored = await repository.restoreMemoryVersion(
      original.memory.id,
      2,
      "集成测试恢复",
    );
    expect(restored.memory.statement).toContain("数据可以迁移");
    expect(restored.version.version).toBe(4);
  });
});
