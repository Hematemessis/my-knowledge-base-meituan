import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteMemoryRepository } from "./sqlite-repository";
import { InMemoryMemoryRepository } from "./in-memory-repository";

const folders: string[] = [];
const repositories = new Set<SQLiteMemoryRepository>();
afterEach(() => {
  for (const r of repositories) r.close(); repositories.clear();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function file() { const folder = mkdtempSync(join(tmpdir(), "knowledge-memory-test-")); folders.push(folder); return join(folder, "test.sqlite"); }
function open(path: string) { const r = new SQLiteMemoryRepository(path, { seed: false }); repositories.add(r); return r; }
function close(r: SQLiteMemoryRepository) { r.close(); repositories.delete(r); }
const memory = { projectId: "project-a", scope: "project" as const, type: "decision" as const, statement: "先完成本机保存。" };
const candidate = { ...memory, subject: "保存方案", confidence: 1, importance: 90 };

describe("local durable memory", () => {
  it("round-trips a complete state without aliasing the source", async () => {
    const r = new InMemoryMemoryRepository({ seed: false });
    await r.captureConfirmedMemory(memory);
    const state = r.exportState(); state.memories[0].statement = "changed";
    expect((await r.listMemories())[0].statement).toBe(memory.statement);
  });
  it("keeps confirmed memories, candidate reviews, undo and versions after closing and reopening", async () => {
    const path = file(); let r = open(path);
    const original = await r.captureConfirmedMemory(memory);
    const { candidates } = await r.captureMemoryCandidates({ sourceText: "补充备份要求", candidates: [{ ...candidate, statement: "先完成本机保存与备份。" }] });
    close(r); r = open(path);
    expect(await r.listMemoryCandidates()).toHaveLength(1);
    await r.reviewMemoryCandidate({ candidateId: candidates[0].id, action: "merge", targetMemoryId: original.memory.id });
    close(r); r = open(path);
    expect((await r.listMemoryVersions(original.memory.id)).map(v => v.version)).toEqual([2, 1]);
    await r.undoMemoryCandidateReview(candidates[0].id);
    close(r); r = open(path);
    expect((await r.listMemories())[0].statement).toBe(memory.statement);
    expect(await r.listMemoryCandidates()).toHaveLength(1);
    await r.restoreMemoryVersion(original.memory.id, 2);
    close(r); r = open(path);
    expect((await r.listMemories())[0].statement).toContain("备份");
    expect(await r.listMemoryVersions(original.memory.id)).toHaveLength(4);
  });
  it("does not commit partial patches on a failed review", async () => {
    const r = open(file());
    const { candidates } = await r.captureMemoryCandidates({ sourceText: "测试", candidates: [candidate] });
    await expect(r.reviewMemoryCandidate({ candidateId: candidates[0].id, action: "merge", patch: { statement: "bad" } })).rejects.toThrow();
    expect((await r.listMemoryCandidates())[0].statement).toBe(candidate.statement);
  });
  it("does not lose concurrent writes from separate connections", async () => {
    const path = file(); const first = open(path); const second = open(path);
    await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? first : second).captureConfirmedMemory({ ...memory, statement: `记录 ${i}` })));
    expect(await first.listMemories()).toHaveLength(24);
    expect(await second.listMemories()).toHaveLength(24);
    expect(await first.listMemories({ projectId: "project-b" })).toHaveLength(0);
  });
});
