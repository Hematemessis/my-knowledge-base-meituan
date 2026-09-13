import { randomUUID } from "node:crypto";
import { localDatabasePath, openLocalDatabase } from "../local-database";
import type { ChatAnswer, Conversation, ConversationSummary, WorkspaceMode } from "./types";

export class ConversationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

const INTERRUPTED = "上次回答未完成，问题已保留。请重新发送问题。";
const LEASE_MS = 150_000; // Longer than the model and candidate extraction timeouts combined.

export class ConversationStore {
  private db;
  constructor(path: string) {
    this.db = openLocalDatabase(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, updated TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversations_project ON conversations(project,updated);
      CREATE TABLE IF NOT EXISTS conversation_results (
        conversation TEXT NOT NULL, request TEXT NOT NULL, answer TEXT NOT NULL,
        PRIMARY KEY(conversation,request));`);
  }
  close() { this.db.close(); }

  private atomic<T>(operation: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private read(projectId: string, id: string): Conversation | null {
    const row = this.db.prepare("SELECT payload FROM conversations WHERE id=? AND project=?").get(id, projectId);
    return row ? JSON.parse(String(row.payload)) as Conversation : null;
  }
  private save(conversation: Conversation) {
    this.db.prepare(`INSERT INTO conversations VALUES (?,?,?,?) ON CONFLICT(id)
      DO UPDATE SET updated=excluded.updated,payload=excluded.payload`)
      .run(conversation.id, conversation.projectId, conversation.updatedAt, JSON.stringify(conversation));
  }

  get(projectId: string, id: string): Conversation | null {
    return this.atomic(() => {
      const conversation = this.read(projectId, id);
      if (conversation?.pending && Date.now() - Date.parse(conversation.pending.startedAt) > LEASE_MS) {
        conversation.messages.push({ id: randomUUID(), role: "assistant", content: INTERRUPTED, failed: true });
        conversation.pending = null;
        this.save(conversation);
      }
      return conversation;
    });
  }

  list(projectId: string): ConversationSummary[] {
    return this.db.prepare("SELECT payload FROM conversations WHERE project=? ORDER BY updated DESC LIMIT 100").all(projectId)
      .map(row => {
        const { messages, documentIds: _documents, ...summary } = JSON.parse(String(row.payload)) as Conversation;
        return { ...summary, messageCount: messages.length };
      });
  }

  begin(input: { id: string; requestId: string; projectId: string; mode: WorkspaceMode;
    message: string; documentIds: string[]; attachments: Array<{ name: string; size: number }> }) {
    return this.atomic(() => {
      const existing = this.db.prepare("SELECT project FROM conversations WHERE id=?").get(input.id);
      if (existing && existing.project !== input.projectId) throw new ConversationError("找不到这段对话", 404);
      const timestamp = new Date().toISOString();
      const conversation = this.read(input.projectId, input.id) ?? {
        id: input.id, projectId: input.projectId, mode: input.mode,
        title: input.message.slice(0, 48), createdAt: timestamp, updatedAt: timestamp,
        documentIds: [], messages: [], pending: null,
      } satisfies Conversation;
      if (conversation.mode !== input.mode) throw new ConversationError("两种用途的对话需要分开，请新建对话");
      const previous = conversation.messages.find(m => m.id === input.requestId);
      if (previous && previous.content !== input.message) throw new ConversationError("重复请求的内容不同，请重新发送");
      const cached = this.db.prepare("SELECT answer FROM conversation_results WHERE conversation=? AND request=?")
        .get(input.id, input.requestId);
      if (cached) return { conversation, cached: JSON.parse(String(cached.answer)) as ChatAnswer };
      if (conversation.pending) {
        if (Date.now() - Date.parse(conversation.pending.startedAt) <= LEASE_MS)
          throw new ConversationError("这段对话正在回答，请稍后再试");
        conversation.messages.push({ id: randomUUID(), role: "assistant", content: INTERRUPTED, failed: true });
        conversation.pending = null;
      }
      // A failed request needs a new id, so old completions can never commit over a retry.
      if (previous) throw new ConversationError("这次回答未完成，请重新发送问题");
      conversation.messages.push({ id: input.requestId, role: "user", content: input.message, attachments: input.attachments });
      conversation.pending = { id: input.requestId, startedAt: timestamp };
      conversation.documentIds = input.documentIds;
      conversation.updatedAt = timestamp;
      this.save(conversation);
      return { conversation, cached: null };
    });
  }

  complete(projectId: string, id: string, requestId: string, answer: ChatAnswer) {
    return this.atomic(() => {
      const conversation = this.read(projectId, id);
      if (conversation?.pending?.id !== requestId) throw new ConversationError("回答状态已变化，请重新发送问题");
      conversation.messages.push({ id: randomUUID(), role: "assistant", content: answer.text,
        mode: answer.mode, model: answer.model, usedMemories: answer.usedMemories, citations: answer.citations });
      conversation.pending = null;
      conversation.updatedAt = new Date().toISOString();
      this.save(conversation);
      this.db.prepare("INSERT INTO conversation_results VALUES (?,?,?)").run(id, requestId, JSON.stringify(answer));
      return conversation;
    });
  }

  fail(projectId: string, id: string, requestId: string, error: string) {
    this.atomic(() => {
      const conversation = this.read(projectId, id);
      if (conversation?.pending?.id !== requestId) return;
      conversation.messages.push({ id: randomUUID(), role: "assistant", content: error, failed: true });
      conversation.pending = null;
      conversation.updatedAt = new Date().toISOString();
      this.save(conversation);
    });
  }
}

const runtime = globalThis as typeof globalThis & { knowledgeConversations?: ConversationStore };
export function getConversationStore() {
  return runtime.knowledgeConversations ??= new ConversationStore(localDatabasePath());
}
