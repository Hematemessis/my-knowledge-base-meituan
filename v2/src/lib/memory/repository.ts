import type {
  CandidateCaptureInput,
  CandidateReviewInput,
  CandidateReviewResult,
  CandidateStatus,
  CandidateUndoResult,
  ConfirmedMemoryInput,
  ContextBundle,
  EventInput,
  EventRecord,
  MemoryCandidateRecord,
  MemoryRecord,
  MemoryStatus,
  MemoryRestoreResult,
  MemoryVersionRecord,
  StorageMode,
} from "./types";

export interface MemoryRepository {
  readonly storageMode: StorageMode;

  recordEvent(input: EventInput): Promise<EventRecord>;

  captureConfirmedMemory(
    input: ConfirmedMemoryInput,
  ): Promise<{ event: EventRecord; memory: MemoryRecord }>;

  captureMemoryCandidates(
    input: CandidateCaptureInput,
  ): Promise<{ event: EventRecord; candidates: MemoryCandidateRecord[] }>;

  listMemoryCandidates(options?: {
    projectId?: string | null;
    status?: CandidateStatus;
  }): Promise<MemoryCandidateRecord[]>;

  reviewMemoryCandidate(
    input: CandidateReviewInput,
  ): Promise<CandidateReviewResult>;

  undoMemoryCandidateReview(
    candidateId: string,
    reason?: string,
  ): Promise<CandidateUndoResult>;

  listMemories(options?: {
    projectId?: string | null;
    status?: MemoryStatus;
  }): Promise<MemoryRecord[]>;

  listMemoryVersions(memoryId: string): Promise<MemoryVersionRecord[]>;

  restoreMemoryVersion(
    memoryId: string,
    version: number,
    reason?: string,
  ): Promise<MemoryRestoreResult>;

  saveContextSnapshot(bundle: ContextBundle): Promise<void>;
}
