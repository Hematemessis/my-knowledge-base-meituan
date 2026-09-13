import { describe, expect, it } from "vitest";

import { InMemoryMemoryRepository } from "./in-memory-repository";
import { assembleContext, captureConfirmedMemory } from "./service";
import { DEMO_PROJECT_ID } from "./types";

describe("memory context core", () => {
  it("records a confirmed memory with its source event", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    const result = await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "产品范围",
      statement: "产品优先保证上下文记忆的准确性。",
      importance: 95,
    });

    expect(result.event.kind).toBe("memory.confirmed");
    expect(result.memory.sourceEventId).toBe(result.event.id);
    expect(result.memory.status).toBe("active");
    expect(result.memory.statement).toContain("上下文记忆");
  });

  it("always includes locked project decisions and ranks relevant memory", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "decision",
      subject: "记忆系统",
      statement: "上下文记忆必须支持版本覆盖和冲突处理。",
      importance: 98,
    });
    await captureConfirmedMemory(repository, {
      projectId: DEMO_PROJECT_ID,
      scope: "project",
      type: "episode",
      subject: "界面",
      statement: "昨天调整了首页卡片圆角。",
      importance: 25,
    });

    const context = await assembleContext(repository, {
      projectId: DEMO_PROJECT_ID,
      query: "我们怎么实现记忆冲突和版本更新？",
      tokenBudget: 1_200,
    });

    const statements = [
      ...context.projectContext,
      ...context.relevantMemories,
    ].map((selection) => selection.memory.statement);
    expect(statements).toContain("上下文记忆必须支持版本覆盖和冲突处理。");
    expect(statements).not.toContain("昨天调整了首页卡片圆角。");
  });

  it("respects the context token budget", async () => {
    const repository = new InMemoryMemoryRepository({ seed: false });
    for (let index = 0; index < 8; index += 1) {
      await captureConfirmedMemory(repository, {
        projectId: DEMO_PROJECT_ID,
        scope: "project",
        type: "decision",
        statement: `上下文架构决策 ${index}：${"需要保留出处和版本。".repeat(20)}`,
        importance: 90,
      });
    }

    const context = await assembleContext(repository, {
      projectId: DEMO_PROJECT_ID,
      query: "上下文架构决策",
      tokenBudget: 200,
      maxMemories: 20,
    });

    expect(context.estimatedTokens).toBeLessThanOrEqual(200);
  });
});
