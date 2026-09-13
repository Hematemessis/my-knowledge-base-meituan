import type { Evidence } from "../documents/types";
import type { ContextBundle, MemoryRecord } from "../memory/types";

export type WorkspaceMode = "documents" | "project";
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ name: string; size: number }>;
  mode?: "model" | "local";
  model?: string | null;
  usedMemories?: MemoryRecord[];
  citations?: Evidence[];
  failed?: boolean;
};

export type ChatAnswer = {
  text: string;
  mode: "model" | "local";
  model: string | null;
  context: ContextBundle;
  usedMemories: MemoryRecord[];
  candidatesCreated: number;
  citations: Evidence[];
};

export type Conversation = {
  id: string;
  projectId: string;
  mode: WorkspaceMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
  messages: ConversationMessage[];
  pending: { id: string; startedAt: string } | null;
};

export type ConversationSummary = Omit<Conversation, "messages" | "documentIds"> & { messageCount: number };
