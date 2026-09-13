import { describe, expect, it } from "vitest";

import { InMemoryMemoryRepository } from "./in-memory-repository";
import {
  captureCandidateMemories,
  captureConfirmedMemory,
  extractMemoryCandidates,
  listCandidateReviews,
  restoreMemoryVersion,
  reviewMemoryCandidate,
  undoMemoryCandidateReview,
} from "./service";
import { DEMO_PROJECT_ID } from "./types";

describe("candidate memory lifecycle", () => {
  it("extracts only explicit long-term signals from source text", () => {
    const candidates = extractMemoryCandidates({
      scope: "project",
      sourceText:
        "我们决定先完成记忆确认。以后每次修改重要决策都要保留版本。这个按钮看起来挺大。",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.type)).toEqual([
      "decision",
      "workflow",
    ]);
    expect(candidates.some((candidate) => candidate.statement.includes("按钮"))).toBe(
      false,
    );
  });

  it("keeps a rejected candidate out of active memory", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const captured = await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "我喜欢每次回答先给结论。",
    });

    await reviewMemoryCandidate(repository, {
      candidateId: captured.candidates[0].id,
      action: "reject",
      reason: "这只是临时要求",
    });

    expect(await repository.listMemories({ projectId: DEMO_PROJECT_ID })).toHaveLength(
      0,
    );
    expect(
      await repository.listMemoryCandidates({
        projectId: DEMO_PROJECT_ID,
        status: "rejected",
      }),
    ).toHaveLength(1);
  });

  it("merges a confirmed candidate into a new version", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const original = await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "项目决策",
      statement: "产品优先保证功能完整度。",
      importance: 90,
    });
    await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "我们决定产品优先保证功能完整度和数据可迁移性。",
    });
    const [review] = await listCandidateReviews(repository, {
      projectId: DEMO_PROJECT_ID,
    });

    expect(review.possibleMatches[0]?.memory.id).toBe(original.memory.id);
    const result = await reviewMemoryCandidate(repository, {
      candidateId: review.candidate.id,
      action: "merge",
      targetMemoryId: original.memory.id,
      reason: "补充数据可迁移要求",
    });
    const versions = await repository.listMemoryVersions(original.memory.id);

    expect(result.memory?.id).toBe(original.memory.id);
    expect(result.memory?.statement).toContain("数据可迁移性");
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it("replaces an old decision without deleting its history", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const original = await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "项目决策",
      statement: "产品优先追求功能完整度。",
      importance: 94,
    });
    const captured = await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "产品方向改为优先轻量可用。",
    });

    const result = await reviewMemoryCandidate(repository, {
      candidateId: captured.candidates[0].id,
      action: "replace",
      targetMemoryId: original.memory.id,
      reason: "阶段策略发生变化",
    });
    const active = await repository.listMemories({
      projectId: DEMO_PROJECT_ID,
      status: "active",
    });
    const superseded = await repository.listMemories({
      projectId: DEMO_PROJECT_ID,
      status: "superseded",
    });

    expect(result.memory?.supersedesId).toBe(original.memory.id);
    expect(active.map((memory) => memory.statement)).toContain(
      "产品方向改为优先轻量可用。",
    );
    expect(superseded.map((memory) => memory.id)).toContain(original.memory.id);
  });

  it("applies user edits before confirming and can undo the review", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const captured = await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "我们决定先完成核心闭环。",
    });

    const reviewed = await reviewMemoryCandidate(repository, {
      candidateId: captured.candidates[0].id,
      action: "accept",
      patch: {
        statement: "我们决定先完成可撤销的核心闭环。",
        importance: 99,
      },
    });
    expect(reviewed.memory?.statement).toContain("可撤销");
    expect(reviewed.memory?.importance).toBe(99);

    const undone = await undoMemoryCandidateReview(
      repository,
      captured.candidates[0].id,
      "误操作",
    );
    expect(undone.candidate.status).toBe("pending");
    expect(
      await repository.listMemories({
        projectId: DEMO_PROJECT_ID,
        status: "active",
      }),
    ).toHaveLength(0);
  });

  it("undoes a merge by appending a compensating version", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const original = await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "数据策略",
      statement: "数据先保存在本地。",
      importance: 90,
    });
    const captured = await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "我们决定数据先保存在本地并支持导出。",
    });
    await reviewMemoryCandidate(repository, {
      candidateId: captured.candidates[0].id,
      action: "merge",
      targetMemoryId: original.memory.id,
    });

    const undone = await undoMemoryCandidateReview(
      repository,
      captured.candidates[0].id,
    );
    const versions = await repository.listMemoryVersions(original.memory.id);

    expect(undone.memory?.statement).toBe("数据先保存在本地。");
    expect(versions.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(versions[0].changeReason).toContain("撤销候选审核");
  });

  it("restores historical content as a new version without rewriting history", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const original = await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "交付策略",
      statement: "第一版策略。",
      importance: 88,
    });
    const captured = await captureCandidateMemories(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      sourceText: "我们决定采用第二版策略。",
    });
    await reviewMemoryCandidate(repository, {
      candidateId: captured.candidates[0].id,
      action: "merge",
      targetMemoryId: original.memory.id,
    });

    const restored = await restoreMemoryVersion(
      repository,
      original.memory.id,
      1,
      "回到稳定方案",
    );
    const versions = await repository.listMemoryVersions(original.memory.id);

    expect(restored.memory.statement).toBe("第一版策略。");
    expect(restored.version.version).toBe(3);
    expect(versions.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(versions[0].changeReason).toContain("恢复 v1");
  });
});
