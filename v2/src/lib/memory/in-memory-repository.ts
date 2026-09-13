import type { MemoryRepository } from "./repository";
import {
  DEMO_PROJECT_ID,
  type CandidateCaptureInput,
  type CandidateReviewInput,
  type CandidateReviewResult,
  type CandidateStatus,
  type CandidateUndoResult,
  type ConfirmedMemoryInput,
  type ContextBundle,
  type EventInput,
  type EventRecord,
  type MemoryCandidateRecord,
  type MemoryRecord,
  type MemoryRestoreResult,
  type MemoryStatus,
  type MemoryVersionRecord,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

function seedMemory(
  statement: string,
  type: MemoryRecord["type"],
  importance: number,
  scope: MemoryRecord["scope"] = "project",
): MemoryRecord {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    projectId: scope === "project" ? DEMO_PROJECT_ID : null,
    scope,
    type,
    subject: "Knowledge Context V2",
    statement,
    status: "active",
    importance,
    confidence: 1,
    sourceEventId: null,
    supersedesId: null,
    validFrom: timestamp,
    validUntil: null,
    lastConfirmedAt: timestamp,
    lastUsedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface MemoryState {
  events: EventRecord[];
  memories: MemoryRecord[];
  candidates: MemoryCandidateRecord[];
  versions: Array<[string, MemoryVersionRecord[]]>;
  snapshots: ContextBundle[];
}

export class InMemoryMemoryRepository implements MemoryRepository {
  readonly storageMode = "memory" as const;
  private readonly events: EventRecord[] = [];
  private readonly memories: MemoryRecord[];
  private readonly candidates: MemoryCandidateRecord[] = [];
  private readonly versions = new Map<string, MemoryVersionRecord[]>();
  private readonly snapshots: ContextBundle[] = [];

  constructor(options: { seed?: boolean; state?: MemoryState } = {}) {
    if (options.state) {
      const state = structuredClone(options.state);
      this.events = state.events;
      this.memories = state.memories;
      this.candidates = state.candidates;
      this.versions = new Map(state.versions);
      this.snapshots = state.snapshots;
      return;
    }
    this.memories = options.seed === false
      ? []
      : [
          seedMemory(
            "这是一个个人 vibe coding 项目，不以商业用户画像作为功能取舍依据。",
            "fact",
            96,
            "global",
          ),
          seedMemory("产品优先追求功能完整度。", "preference", 94),
          seedMemory(
            "系统持续记住用户确认过的事实、偏好、项目状态和决策，是产品的核心能力。",
            "decision",
            100,
          ),
        ];
    for (const memory of this.memories) {
      this.versions.set(memory.id, [
        {
          id: crypto.randomUUID(),
          memoryId: memory.id,
          version: 1,
          statement: memory.statement,
          subject: memory.subject,
          importance: memory.importance,
          confidence: memory.confidence,
          changeReason: "初始确认",
          sourceEventId: memory.sourceEventId,
          createdAt: memory.createdAt,
        },
      ]);
    }
  }

  exportState(): MemoryState {
    return structuredClone({ events: this.events, memories: this.memories,
      candidates: this.candidates, versions: [...this.versions], snapshots: this.snapshots });
  }

  async recordEvent(input: EventInput): Promise<EventRecord> {
    const event: EventRecord = {
      id: crypto.randomUUID(),
      projectId: input.projectId ?? null,
      actor: input.actor,
      kind: input.kind,
      payload: input.payload ?? {},
      createdAt: now(),
    };
    this.events.push(event);
    return event;
  }

  async captureConfirmedMemory(
    input: ConfirmedMemoryInput,
  ): Promise<{ event: EventRecord; memory: MemoryRecord }> {
    const event = await this.recordEvent({
      projectId: input.projectId,
      actor: "user",
      kind: "memory.confirmed",
      payload: {
        scope: input.scope,
        type: input.type,
        subject: input.subject ?? "",
        statement: input.statement,
      },
    });
    const timestamp = now();
    const memory: MemoryRecord = {
      id: crypto.randomUUID(),
      projectId: input.scope === "project" ? input.projectId ?? null : null,
      scope: input.scope,
      type: input.type,
      subject: input.subject ?? "",
      statement: input.statement,
      status: "active",
      importance: input.importance ?? 70,
      confidence: input.confidence ?? 1,
      sourceEventId: event.id,
      supersedesId: null,
      validFrom: timestamp,
      validUntil: null,
      lastConfirmedAt: timestamp,
      lastUsedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.memories.unshift(memory);
    this.versions.set(memory.id, [
      {
        id: crypto.randomUUID(),
        memoryId: memory.id,
        version: 1,
        statement: memory.statement,
        subject: memory.subject,
        importance: memory.importance,
        confidence: memory.confidence,
        changeReason: "用户确认",
        sourceEventId: event.id,
        createdAt: timestamp,
      },
    ]);
    return { event, memory };
  }

  async captureMemoryCandidates(
    input: CandidateCaptureInput,
  ): Promise<{ event: EventRecord; candidates: MemoryCandidateRecord[] }> {
    const event = await this.recordEvent({
      projectId: input.projectId,
      actor: "user",
      kind: "memory.source_captured",
      payload: {
        sourceText: input.sourceText,
        extractor: input.extractor ?? "heuristic",
      },
    });
    const timestamp = now();
    const candidates = input.candidates.map<MemoryCandidateRecord>((draft) => ({
      id: crypto.randomUUID(),
      projectId: draft.scope === "project" ? input.projectId ?? null : null,
      sourceEventId: event.id,
      scope: draft.scope,
      type: draft.type,
      subject: draft.subject,
      statement: draft.statement,
      confidence: draft.confidence,
      importance: draft.importance,
      status: "pending",
      decisionReason: "",
      reviewAction: null,
      targetMemoryId: null,
      resultMemoryId: null,
      reviewEventId: null,
      resultVersion: null,
      createdAt: timestamp,
      reviewedAt: null,
    }));
    this.candidates.unshift(...candidates);
    return { event, candidates: structuredClone(candidates) };
  }

  async listMemoryCandidates(
    options: { projectId?: string | null; status?: CandidateStatus } = {},
  ): Promise<MemoryCandidateRecord[]> {
    const status = options.status ?? "pending";
    return this.candidates
      .filter((candidate) => candidate.status === status)
      .filter((candidate) => {
        if (!options.projectId) return true;
        return candidate.scope === "global" || candidate.projectId === options.projectId;
      })
      .map((candidate) => structuredClone(candidate));
  }

  async reviewMemoryCandidate(
    input: CandidateReviewInput,
  ): Promise<CandidateReviewResult> {
    const candidate = this.candidates.find((item) => item.id === input.candidateId);
    if (!candidate) throw new Error("候选记忆不存在");
    if (candidate.status !== "pending") throw new Error("候选记忆已经处理");

    if (input.patch) {
      if (input.patch.subject !== undefined) {
        candidate.subject = input.patch.subject.trim();
      }
      if (input.patch.statement !== undefined) {
        candidate.statement = input.patch.statement.trim();
      }
      if (input.patch.importance !== undefined) {
        candidate.importance = Math.min(100, Math.max(0, input.patch.importance));
      }
    }

    const target = input.targetMemoryId
      ? this.memories.find((memory) => memory.id === input.targetMemoryId)
      : undefined;
    if ((input.action === "merge" || input.action === "replace") && !target) {
      throw new Error("合并或替代时必须选择已有记忆");
    }
    if (target && target.status !== "active") {
      throw new Error("只能更新当前有效的记忆");
    }

    const timestamp = now();
    const previousMemory = target ? structuredClone(target) : null;
    const event = await this.recordEvent({
      projectId: candidate.projectId,
      actor: "user",
      kind: `memory_candidate.${input.action}`,
      payload: {
        candidateId: candidate.id,
        sourceEventId: candidate.sourceEventId,
        targetMemoryId: target?.id ?? null,
        reason: input.reason ?? "",
      },
    });

    candidate.reviewedAt = timestamp;
    candidate.decisionReason = input.reason ?? "";
    candidate.reviewAction = input.action;
    candidate.targetMemoryId = target?.id ?? null;
    candidate.reviewEventId = event.id;

    if (input.action === "reject") {
      candidate.status = "rejected";
      return {
        event,
        candidate: structuredClone(candidate),
        memory: null,
        previousMemory,
      };
    }

    if (input.action === "merge" && target) {
      target.subject = candidate.subject;
      target.statement = candidate.statement;
      target.importance = Math.max(target.importance, candidate.importance);
      target.confidence = Math.max(target.confidence, candidate.confidence);
      target.sourceEventId = event.id;
      target.lastConfirmedAt = timestamp;
      target.updatedAt = timestamp;
      candidate.status = "merged";
      const versions = this.versions.get(target.id) ?? [];
      versions.push({
        id: crypto.randomUUID(),
        memoryId: target.id,
        version: versions.length + 1,
        statement: target.statement,
        subject: target.subject,
        importance: target.importance,
        confidence: target.confidence,
        changeReason: input.reason || "候选记忆合并为新版本",
        sourceEventId: event.id,
        createdAt: timestamp,
      });
      this.versions.set(target.id, versions);
      candidate.resultMemoryId = target.id;
      candidate.resultVersion = versions.length;
      return {
        event,
        candidate: structuredClone(candidate),
        memory: structuredClone(target),
        previousMemory,
      };
    }

    if (input.action === "replace" && target) {
      target.status = "superseded";
      target.validUntil = timestamp;
      target.updatedAt = timestamp;
    }

    const memory: MemoryRecord = {
      id: crypto.randomUUID(),
      projectId: candidate.scope === "project" ? candidate.projectId : null,
      scope: candidate.scope,
      type: candidate.type,
      subject: candidate.subject,
      statement: candidate.statement,
      status: "active",
      importance: candidate.importance,
      confidence: candidate.confidence,
      sourceEventId: event.id,
      supersedesId: input.action === "replace" ? target?.id ?? null : null,
      validFrom: timestamp,
      validUntil: null,
      lastConfirmedAt: timestamp,
      lastUsedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    candidate.status = "accepted";
    candidate.resultMemoryId = memory.id;
    candidate.resultVersion = 1;
    this.memories.unshift(memory);
    this.versions.set(memory.id, [
      {
        id: crypto.randomUUID(),
        memoryId: memory.id,
        version: 1,
        statement: memory.statement,
        subject: memory.subject,
        importance: memory.importance,
        confidence: memory.confidence,
        changeReason:
          input.action === "replace" ? input.reason || "替代旧记忆" : "接受候选记忆",
        sourceEventId: event.id,
        createdAt: timestamp,
      },
    ]);
    return {
      event,
      candidate: structuredClone(candidate),
      memory: structuredClone(memory),
      previousMemory,
    };
  }

  async undoMemoryCandidateReview(
    candidateId: string,
    reason = "",
  ): Promise<CandidateUndoResult> {
    const candidate = this.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("候选记忆不存在");
    if (candidate.status === "pending" || !candidate.reviewAction) {
      throw new Error("候选记忆没有可撤销的审核操作");
    }

    const timestamp = now();
    const resultMemory = candidate.resultMemoryId
      ? this.memories.find((memory) => memory.id === candidate.resultMemoryId)
      : undefined;
    const targetMemory = candidate.targetMemoryId
      ? this.memories.find((memory) => memory.id === candidate.targetMemoryId)
      : undefined;
    const event = await this.recordEvent({
      projectId: candidate.projectId,
      actor: "user",
      kind: "memory_candidate.review_undone",
      payload: {
        candidateId: candidate.id,
        reviewAction: candidate.reviewAction,
        reviewEventId: candidate.reviewEventId,
        reason,
      },
    });

    let memory: MemoryRecord | null = null;
    let restoredMemory: MemoryRecord | null = null;
    if (candidate.reviewAction === "accept" || candidate.reviewAction === "replace") {
      if (!resultMemory) throw new Error("审核生成的记忆不存在，无法撤销");
      const versions = this.versions.get(resultMemory.id) ?? [];
      const latestVersion = versions.at(-1)?.version ?? 0;
      if (latestVersion !== candidate.resultVersion) {
        throw new Error("记忆已经再次更新，不能直接撤销较早的审核");
      }
      resultMemory.status = "archived";
      resultMemory.validUntil = timestamp;
      resultMemory.updatedAt = timestamp;
      memory = structuredClone(resultMemory);
      if (candidate.reviewAction === "replace") {
        if (!targetMemory) throw new Error("被替代的旧记忆不存在，无法撤销");
        targetMemory.status = "active";
        targetMemory.validUntil = null;
        targetMemory.updatedAt = timestamp;
        targetMemory.lastConfirmedAt = timestamp;
        restoredMemory = structuredClone(targetMemory);
      }
    }

    if (candidate.reviewAction === "merge") {
      if (!resultMemory || !candidate.resultVersion || candidate.resultVersion <= 1) {
        throw new Error("合并版本信息不完整，无法撤销");
      }
      const versions = this.versions.get(resultMemory.id) ?? [];
      const latestVersion = versions.at(-1)?.version ?? 0;
      if (latestVersion !== candidate.resultVersion) {
        throw new Error("记忆已经再次更新，不能直接撤销较早的合并");
      }
      const previousVersion = versions.find(
        (version) => version.version === candidate.resultVersion! - 1,
      );
      if (!previousVersion) throw new Error("找不到合并前的记忆版本");
      resultMemory.subject = previousVersion.subject;
      resultMemory.statement = previousVersion.statement;
      resultMemory.importance = previousVersion.importance;
      resultMemory.confidence = previousVersion.confidence;
      resultMemory.sourceEventId = event.id;
      resultMemory.lastConfirmedAt = timestamp;
      resultMemory.updatedAt = timestamp;
      versions.push({
        id: crypto.randomUUID(),
        memoryId: resultMemory.id,
        version: latestVersion + 1,
        statement: previousVersion.statement,
        subject: previousVersion.subject,
        importance: previousVersion.importance,
        confidence: previousVersion.confidence,
        changeReason: reason || `撤销候选审核，恢复 v${previousVersion.version}`,
        sourceEventId: event.id,
        createdAt: timestamp,
      });
      memory = structuredClone(resultMemory);
      restoredMemory = structuredClone(resultMemory);
    }

    candidate.status = "pending";
    candidate.decisionReason = "";
    candidate.reviewAction = null;
    candidate.targetMemoryId = null;
    candidate.resultMemoryId = null;
    candidate.reviewEventId = null;
    candidate.resultVersion = null;
    candidate.reviewedAt = null;

    return {
      event,
      candidate: structuredClone(candidate),
      memory,
      restoredMemory,
    };
  }

  async listMemories(
    options: { projectId?: string | null; status?: MemoryStatus } = {},
  ): Promise<MemoryRecord[]> {
    const status = options.status ?? "active";
    return this.memories
      .filter((memory) => memory.status === status)
      .filter((memory) => {
        if (!options.projectId) return true;
        return memory.scope === "global" || memory.projectId === options.projectId;
      })
      .map((memory) => ({ ...memory }));
  }

  async listMemoryVersions(memoryId: string): Promise<MemoryVersionRecord[]> {
    return structuredClone(this.versions.get(memoryId) ?? []).sort(
      (left, right) => right.version - left.version,
    );
  }

  async restoreMemoryVersion(
    memoryId: string,
    version: number,
    reason = "",
  ): Promise<MemoryRestoreResult> {
    const memory = this.memories.find((item) => item.id === memoryId);
    if (!memory) throw new Error("记忆不存在");
    if (memory.status !== "active") throw new Error("只能恢复当前有效记忆的历史版本");
    const versions = this.versions.get(memoryId) ?? [];
    const targetVersion = versions.find((item) => item.version === version);
    if (!targetVersion) throw new Error("目标版本不存在");
    const latestVersion = versions.at(-1)?.version ?? 0;
    if (targetVersion.version === latestVersion) throw new Error("目标版本已经是当前版本");

    const timestamp = now();
    const event = await this.recordEvent({
      projectId: memory.projectId,
      actor: "user",
      kind: "memory.version_restored",
      payload: { memoryId, restoredFromVersion: version, reason },
    });
    memory.subject = targetVersion.subject;
    memory.statement = targetVersion.statement;
    memory.importance = targetVersion.importance;
    memory.confidence = targetVersion.confidence;
    memory.sourceEventId = event.id;
    memory.lastConfirmedAt = timestamp;
    memory.updatedAt = timestamp;
    const restoredVersion: MemoryVersionRecord = {
      id: crypto.randomUUID(),
      memoryId,
      version: latestVersion + 1,
      statement: targetVersion.statement,
      subject: targetVersion.subject,
      importance: targetVersion.importance,
      confidence: targetVersion.confidence,
      changeReason: reason ? `恢复 v${version}：${reason}` : `恢复到 v${version}`,
      sourceEventId: event.id,
      createdAt: timestamp,
    };
    versions.push(restoredVersion);
    this.versions.set(memoryId, versions);
    return {
      event,
      memory: structuredClone(memory),
      version: structuredClone(restoredVersion),
      restoredFromVersion: version,
    };
  }

  async saveContextSnapshot(bundle: ContextBundle): Promise<void> {
    this.snapshots.push(structuredClone(bundle));
  }
}

const runtime = globalThis as typeof globalThis & {
  knowledgeMemoryRepository?: InMemoryMemoryRepository;
};

export function getInMemoryRepository(): InMemoryMemoryRepository {
  if (!runtime.knowledgeMemoryRepository) {
    runtime.knowledgeMemoryRepository = new InMemoryMemoryRepository();
  }
  return runtime.knowledgeMemoryRepository;
}
