import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerWithAssistantProvider,
  classifyMemoryTypeWithProvider,
} from "./provider";

const keys = [
  "AI_CHAT_URL",
  "AI_CHAT_API_KEY",
  "AI_CHAT_MODEL",
  "HF_TOKEN",
  "HF_MODEL",
] as const;

const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
) as Record<(typeof keys)[number], string | undefined>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of keys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("assistant provider", () => {
  it("stays in local mode when no provider is configured", async () => {
    for (const key of keys) delete process.env[key];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerWithAssistantProvider({
      message: "下一步做什么？",
      history: [],
      memoryContext: "没有相关记忆",
      attachmentContext: "",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends memories and files to a compatible chat provider", async () => {
    process.env.AI_CHAT_URL = "https://provider.test/v1/chat/completions";
    process.env.AI_CHAT_API_KEY = "secret";
    process.env.AI_CHAT_MODEL = "test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "这是结合上下文的回答。" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerWithAssistantProvider({
      message: "继续规划",
      history: [{ role: "assistant", content: "好的" }],
      memoryContext: "已确认记忆：优先数据可迁移",
      attachmentContext: "文件：项目说明",
    });

    expect(result).toEqual({ text: "这是结合上下文的回答。", model: "test-model" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(request.messages[0].content).toContain("优先数据可迁移");
    expect(request.messages[0].content).toContain("项目说明");
  });

  it("uses the provider to classify a memory into one allowed type", async () => {
    process.env.AI_CHAT_URL = "https://provider.test/v1/chat/completions";
    process.env.AI_CHAT_MODEL = "test-model";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "decision" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      classifyMemoryTypeWithProvider("我们决定默认让 AI 自动归类。"),
    ).resolves.toBe("decision");
  });
});
