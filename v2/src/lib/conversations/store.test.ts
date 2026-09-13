import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationStore } from "./store";
import type { ChatAnswer } from "./types";

const folders: string[] = [];
const stores = new Set<ConversationStore>();
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores) store.close(); stores.clear();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function file() { const folder = mkdtempSync(join(tmpdir(), "knowledge-chat-test-")); folders.push(folder); return join(folder, "test.sqlite"); }
function open(path = ":memory:") { const store = new ConversationStore(path); stores.add(store); return store; }
function close(store: ConversationStore) { store.close(); stores.delete(store); }
const input = { id: "conversation-a", projectId: "project-a", requestId: "request-a", mode: "documents" as const,
  message: "上线日期？", documentIds: ["doc-a"], attachments: [{ name: "方案.txt", size: 60 }] };
const answer: ChatAnswer = { text: "10月15日。[1]", mode: "model", model: "test-model", usedMemories: [], candidatesCreated: 0,
  context: { id: "context", storageMode: "sqlite", projectId: "project-a", query: "上线日期", tokenBudget: 100,
    estimatedTokens: 0, generatedAt: "2026-09-13", globalContext: [], projectContext: [], relevantMemories: [] },
  citations: [{ id: "chunk-a", documentId: "doc-a", name: "方案.txt", version: 1, updatedAt: "2026-09-13", ordinal: 1,
    text: "上线日期为10月15日。", start: 0, end: 13, citation: 1 }] };

describe("durable conversations", () => {
  it("saves the user before generation and keeps answers and citations across reopen", () => {
    const path = file(); let store = open(path);
    store.begin(input); close(store); store = open(path);
    expect(store.get(input.projectId, input.id)?.messages[0].content).toBe(input.message);
    expect(store.get(input.projectId, input.id)?.pending?.id).toBe(input.requestId);
    store.complete(input.projectId, input.id, input.requestId, answer);
    close(store); store = open(path);
    expect(store.get(input.projectId, input.id)?.messages[1].citations).toEqual(answer.citations);
    expect(store.get(input.projectId, input.id)?.documentIds).toEqual(input.documentIds);
    expect(store.list(input.projectId)[0].messageCount).toBe(2);
  });
  it("rejects mode/project changes, serializes turns and returns a cached completion on duplicate delivery", () => {
    const store = open(); store.begin(input);
    expect(() => store.begin({ ...input, requestId: "other" })).toThrow("正在回答");
    expect(() => store.begin({ ...input, projectId: "other" })).toThrow("找不到");
    expect(() => store.begin({ ...input, mode: "project" })).toThrow("分开");
    store.complete(input.projectId, input.id, input.requestId, answer);
    expect(store.begin(input).cached).toEqual(answer);
    expect(() => store.begin({ ...input, message: "changed" })).toThrow("内容不同");
    expect(store.get("other", input.id)).toBeNull();
    expect(store.list("other")).toEqual([]);
    expect(store.get(input.projectId, input.id)?.messages).toHaveLength(2);
  });
  it("keeps failed questions and allows a fresh retry without a late result overwriting it", () => {
    const store = open(); store.begin(input);
    store.fail(input.projectId, input.id, input.requestId, "模型超时");
    expect(store.get(input.projectId, input.id)?.messages[1].failed).toBe(true);
    expect(() => store.begin(input)).toThrow("重新发送");
    store.begin({ ...input, requestId: "retry" });
    store.fail(input.projectId, input.id, input.requestId, "旧请求");
    expect(store.get(input.projectId, input.id)?.pending?.id).toBe("retry");
    expect(() => store.complete(input.projectId, input.id, input.requestId, answer)).toThrow();
    store.complete(input.projectId, input.id, "retry", answer);
    expect(store.get(input.projectId, input.id)?.messages).toHaveLength(4);
  });
  it("recovers an abandoned turn after its lease instead of staying busy forever", () => {
    vi.useFakeTimers(); const store = open(); store.begin(input);
    vi.advanceTimersByTime(151_000);
    const saved = store.get(input.projectId, input.id)!;
    expect(saved.pending).toBeNull();
    expect(saved.messages.at(-1)?.failed).toBe(true);
    store.begin({ ...input, requestId: "after-restart" });
    expect(() => store.complete(input.projectId, input.id, input.requestId, answer)).toThrow();
  });
});
