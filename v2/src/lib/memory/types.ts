export const DEMO_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

export const memoryTypes = [
  "fact",
  "preference",
  "decision",
  "goal",
  "workflow",
  "episode",
] as const;

export const memoryScopes = ["global", "project"] as const;
export const memoryStatuses = [
  "pending",
  "active",
  "superseded",
  "rejected",
  "archived",
] as const;
export const candidateStatuses = [
  "pending",
  "accepted",
  "rejected",
  "merged",
] as const;
export const candidateReviewActions = [
  "accept",
  "reject",
  "merge",
  "replace",
] as const;

export type MemoryType = (typeof memoryTypes)[number];
export type MemoryScope = (typeof memoryScopes)[number];
export type MemoryStatus = (typeof memoryStatuses)[number];
export type CandidateStatus = (typeof candidateStatuses)[number];
export type CandidateReviewAction = (typeof candidateReviewActions)[number];
export type StorageMode = "memory" | "sqlite" | "postgres";

export interface EventRecord {
  id: string;
  projectId: string | null;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string | null;
  scope: MemoryScope;
  type: MemoryType;
  subject: string;
  statement: string;
  status: MemoryStatus;
  importance: number;
  confidence: number;
  sourceEventId: string | null;
  supersedesId: string | null;
  validFrom: string;
  validUntil: string | null;
  lastConfirmedAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmedMemoryInput {
  projectId?: string | null;
  scope: MemoryScope;
  type: MemoryType;
  subject?: string;
  statement: string;
  importance?: number;
  confidence?: number;
}

export interface MemoryCandidateDraft {
  scope: MemoryScope;
  type: MemoryType;
  subject: string;
  statement: string;
  confidence: number;
  importance: number;
}

export interface MemoryCandidateRecord extends MemoryCandidateDraft {
  id: string;
  projectId: string | null;
  sourceEventId: string;
  status: CandidateStatus;
  decisionReason: string;
  reviewAction: CandidateReviewAction | null;
  targetMemoryId: string | null;
  resultMemoryId: string | null;
  reviewEventId: string | null;
  resultVersion: number | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface CandidateCaptureInput {
  projectId?: string | null;
  sourceText: string;
  candidates: MemoryCandidateDraft[];
  extractor?: "heuristic" | "model";
}

export interface CandidateReviewInput {
  candidateId: string;
  action: CandidateReviewAction;
  targetMemoryId?: string | null;
  reason?: string;
  patch?: {
    subject?: string;
    statement?: string;
    importance?: number;
  };
}

export interface MemoryVersionRecord {
  id: string;
  memoryId: string;
  version: number;
  statement: string;
  subject: string;
  importance: number;
  confidence: number;
  changeReason: string;
  sourceEventId: string | null;
  createdAt: string;
}

export interface CandidateReviewResult {
  event: EventRecord;
  candidate: MemoryCandidateRecord;
  memory: MemoryRecord | null;
  previousMemory: MemoryRecord | null;
}

export interface CandidateUndoResult {
  event: EventRecord;
  candidate: MemoryCandidateRecord;
  memory: MemoryRecord | null;
  restoredMemory: MemoryRecord | null;
}

export interface MemoryRestoreResult {
  event: EventRecord;
  memory: MemoryRecord;
  version: MemoryVersionRecord;
  restoredFromVersion: number;
}

export interface CandidateMatch {
  memory: MemoryRecord;
  similarity: number;
  reasons: string[];
}

export interface CandidateReviewItem {
  candidate: MemoryCandidateRecord;
  possibleMatches: CandidateMatch[];
  suggestedAction: "accept" | "merge" | "replace";
}

export interface EventInput {
  projectId?: string | null;
  actor: string;
  kind: string;
  payload?: Record<string, unknown>;
}

export interface ContextSelection {
  memory: MemoryRecord;
  score: number;
  relevance: number;
  estimatedTokens: number;
  reasons: string[];
}

export interface ContextBundle {
  id: string;
  storageMode: StorageMode;
  projectId: string | null;
  query: string;
  tokenBudget: number;
  estimatedTokens: number;
  generatedAt: string;
  globalContext: ContextSelection[];
  projectContext: ContextSelection[];
  relevantMemories: ContextSelection[];
}
