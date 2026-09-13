import { and, desc, eq, max, or } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import {
  contextSnapshots,
  events,
  memories,
  memoryCandidates,
  memoryRelations,
  memoryUsageLogs,
  memoryVersions,
} from "@/lib/db/schema";

import type { MemoryRepository } from "./repository";
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
  MemoryRestoreResult,
  MemoryStatus,
  MemoryVersionRecord,
} from "./types";

function asEvent(row: typeof events.$inferSelect): EventRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    actor: row.actor,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

function asMemory(row: typeof memories.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: row.scope,
    type: row.type,
    subject: row.subject,
    statement: row.statement,
    status: row.status,
    importance: row.importance,
    confidence: row.confidence,
    sourceEventId: row.sourceEventId,
    supersedesId: row.supersedesId,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    lastConfirmedAt: row.lastConfirmedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asCandidate(
  row: typeof memoryCandidates.$inferSelect,
): MemoryCandidateRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceEventId: row.sourceEventId,
    scope: row.scope,
    type: row.type,
    subject: row.subject,
    statement: row.statement,
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    decisionReason: row.decisionReason,
    reviewAction: row.reviewAction as MemoryCandidateRecord["reviewAction"],
    targetMemoryId: row.targetMemoryId,
    resultMemoryId: row.resultMemoryId,
    reviewEventId: row.reviewEventId,
    resultVersion: row.resultVersion,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

function asVersion(row: typeof memoryVersions.$inferSelect): MemoryVersionRecord {
  return {
    id: row.id,
    memoryId: row.memoryId,
    version: row.version,
    statement: row.statement,
    subject: row.subject,
    importance: row.importance,
    confidence: row.confidence,
    changeReason: row.changeReason,
    sourceEventId: row.sourceEventId,
    createdAt: row.createdAt,
  };
}

export class PostgresMemoryRepository implements MemoryRepository {
  readonly storageMode = "postgres" as const;

  async recordEvent(input: EventInput): Promise<EventRecord> {
    const db = getDatabase();
    const [event] = await db
      .insert(events)
      .values({
        projectId: input.projectId ?? null,
        actor: input.actor,
        kind: input.kind,
        payload: input.payload ?? {},
      })
      .returning();
    return asEvent(event);
  }

  async captureConfirmedMemory(
    input: ConfirmedMemoryInput,
  ): Promise<{ event: EventRecord; memory: MemoryRecord }> {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          projectId: input.projectId ?? null,
          actor: "user",
          kind: "memory.confirmed",
          payload: {
            scope: input.scope,
            type: input.type,
            subject: input.subject ?? "",
            statement: input.statement,
          },
        })
        .returning();

      const [memory] = await tx
        .insert(memories)
        .values({
          projectId: input.scope === "project" ? input.projectId ?? null : null,
          scope: input.scope,
          type: input.type,
          subject: input.subject ?? "",
          statement: input.statement,
          status: "active",
          importance: input.importance ?? 70,
          confidence: input.confidence ?? 1,
          sourceEventId: event.id,
        })
        .returning();

      await tx.insert(memoryVersions).values({
        memoryId: memory.id,
        version: 1,
        statement: memory.statement,
        subject: memory.subject,
        importance: memory.importance,
        confidence: memory.confidence,
        changeReason: "用户确认",
        sourceEventId: event.id,
      });

      return { event: asEvent(event), memory: asMemory(memory) };
    });
  }

  async captureMemoryCandidates(
    input: CandidateCaptureInput,
  ): Promise<{ event: EventRecord; candidates: MemoryCandidateRecord[] }> {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          projectId: input.projectId ?? null,
          actor: "user",
          kind: "memory.source_captured",
          payload: {
            sourceText: input.sourceText,
            extractor: input.extractor ?? "heuristic",
          },
        })
        .returning();

      if (input.candidates.length === 0) {
        return { event: asEvent(event), candidates: [] };
      }

      const rows = await tx
        .insert(memoryCandidates)
        .values(
          input.candidates.map((candidate) => ({
            projectId:
              candidate.scope === "project" ? input.projectId ?? null : null,
            sourceEventId: event.id,
            scope: candidate.scope,
            type: candidate.type,
            subject: candidate.subject,
            statement: candidate.statement,
            confidence: candidate.confidence,
            importance: candidate.importance,
          })),
        )
        .returning();
      return { event: asEvent(event), candidates: rows.map(asCandidate) };
    });
  }

  async listMemoryCandidates(
    options: { projectId?: string | null; status?: CandidateStatus } = {},
  ): Promise<MemoryCandidateRecord[]> {
    const db = getDatabase();
    const status = options.status ?? "pending";
    const scopeCondition = options.projectId
      ? or(
          eq(memoryCandidates.scope, "global"),
          and(
            eq(memoryCandidates.scope, "project"),
            eq(memoryCandidates.projectId, options.projectId),
          ),
        )
      : undefined;
    const rows = await db
      .select()
      .from(memoryCandidates)
      .where(
        scopeCondition
          ? and(eq(memoryCandidates.status, status), scopeCondition)
          : eq(memoryCandidates.status, status),
      )
      .orderBy(desc(memoryCandidates.createdAt));
    return rows.map(asCandidate);
  }

  async reviewMemoryCandidate(
    input: CandidateReviewInput,
  ): Promise<CandidateReviewResult> {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [storedCandidate] = await tx
        .select()
        .from(memoryCandidates)
        .where(eq(memoryCandidates.id, input.candidateId))
        .limit(1)
        .for("update");
      if (!storedCandidate) throw new Error("候选记忆不存在");
      if (storedCandidate.status !== "pending") throw new Error("候选记忆已经处理");

      let candidate = storedCandidate;
      if (input.patch) {
        const [updatedCandidate] = await tx
          .update(memoryCandidates)
          .set({
            subject:
              input.patch.subject !== undefined
                ? input.patch.subject.trim()
                : candidate.subject,
            statement:
              input.patch.statement !== undefined
                ? input.patch.statement.trim()
                : candidate.statement,
            importance:
              input.patch.importance !== undefined
                ? Math.min(100, Math.max(0, input.patch.importance))
                : candidate.importance,
          })
          .where(eq(memoryCandidates.id, candidate.id))
          .returning();
        candidate = updatedCandidate;
      }

      const [target] = input.targetMemoryId
        ? await tx
            .select()
            .from(memories)
            .where(eq(memories.id, input.targetMemoryId))
            .limit(1)
            .for("update")
        : [];
      if ((input.action === "merge" || input.action === "replace") && !target) {
        throw new Error("合并或替代时必须选择已有记忆");
      }
      if (target && target.status !== "active") {
        throw new Error("只能更新当前有效的记忆");
      }
      if (
        target &&
        (target.scope !== candidate.scope ||
          target.type !== candidate.type ||
          target.projectId !== candidate.projectId)
      ) {
        throw new Error("候选记忆和目标记忆的范围或类型不一致");
      }

      const timestamp = new Date().toISOString();
      const [event] = await tx
        .insert(events)
        .values({
          projectId: candidate.projectId,
          actor: "user",
          kind: `memory_candidate.${input.action}`,
          payload: {
            candidateId: candidate.id,
            sourceEventId: candidate.sourceEventId,
            targetMemoryId: target?.id ?? null,
            reason: input.reason ?? "",
          },
        })
        .returning();

      if (input.action === "reject") {
        const [reviewedCandidate] = await tx
          .update(memoryCandidates)
          .set({
            status: "rejected",
            decisionReason: input.reason ?? "",
            reviewAction: input.action,
            targetMemoryId: target?.id ?? null,
            resultMemoryId: null,
            reviewEventId: event.id,
            resultVersion: null,
            reviewedAt: timestamp,
          })
          .where(eq(memoryCandidates.id, candidate.id))
          .returning();
        return {
          event: asEvent(event),
          candidate: asCandidate(reviewedCandidate),
          memory: null,
          previousMemory: target ? asMemory(target) : null,
        };
      }

      if (input.action === "merge" && target) {
        const [{ latestVersion }] = await tx
          .select({ latestVersion: max(memoryVersions.version) })
          .from(memoryVersions)
          .where(eq(memoryVersions.memoryId, target.id));
        const [memory] = await tx
          .update(memories)
          .set({
            subject: candidate.subject,
            statement: candidate.statement,
            importance: Math.max(target.importance, candidate.importance),
            confidence: Math.max(target.confidence, candidate.confidence),
            sourceEventId: event.id,
            lastConfirmedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(memories.id, target.id))
          .returning();
        const nextVersion = Number(latestVersion ?? 0) + 1;
        await tx.insert(memoryVersions).values({
          memoryId: target.id,
          version: nextVersion,
          statement: memory.statement,
          subject: memory.subject,
          importance: memory.importance,
          confidence: memory.confidence,
          changeReason: input.reason || "候选记忆合并为新版本",
          sourceEventId: event.id,
        });
        const [reviewedCandidate] = await tx
          .update(memoryCandidates)
          .set({
            status: "merged",
            decisionReason: input.reason ?? "",
            reviewAction: input.action,
            targetMemoryId: target.id,
            resultMemoryId: target.id,
            reviewEventId: event.id,
            resultVersion: nextVersion,
            reviewedAt: timestamp,
          })
          .where(eq(memoryCandidates.id, candidate.id))
          .returning();
        return {
          event: asEvent(event),
          candidate: asCandidate(reviewedCandidate),
          memory: asMemory(memory),
          previousMemory: asMemory(target),
        };
      }

      if (input.action === "replace" && target) {
        await tx
          .update(memories)
          .set({
            status: "superseded",
            validUntil: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(memories.id, target.id));
      }

      const [memory] = await tx
        .insert(memories)
        .values({
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
        })
        .returning();
      await tx.insert(memoryVersions).values({
        memoryId: memory.id,
        version: 1,
        statement: memory.statement,
        subject: memory.subject,
        importance: memory.importance,
        confidence: memory.confidence,
        changeReason:
          input.action === "replace" ? input.reason || "替代旧记忆" : "接受候选记忆",
        sourceEventId: event.id,
      });
      if (input.action === "replace" && target) {
        await tx.insert(memoryRelations).values({
          fromMemoryId: memory.id,
          toMemoryId: target.id,
          relation: "supersedes",
        });
      }
      const [reviewedCandidate] = await tx
        .update(memoryCandidates)
        .set({
          status: "accepted",
          decisionReason: input.reason ?? "",
          reviewAction: input.action,
          targetMemoryId: target?.id ?? null,
          resultMemoryId: memory.id,
          reviewEventId: event.id,
          resultVersion: 1,
          reviewedAt: timestamp,
        })
        .where(eq(memoryCandidates.id, candidate.id))
        .returning();
      return {
        event: asEvent(event),
        candidate: asCandidate(reviewedCandidate),
        memory: asMemory(memory),
        previousMemory: target ? asMemory(target) : null,
      };
    });
  }

  async undoMemoryCandidateReview(
    candidateId: string,
    reason = "",
  ): Promise<CandidateUndoResult> {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(memoryCandidates)
        .where(eq(memoryCandidates.id, candidateId))
        .limit(1)
        .for("update");
      if (!candidate) throw new Error("候选记忆不存在");
      if (candidate.status === "pending" || !candidate.reviewAction) {
        throw new Error("候选记忆没有可撤销的审核操作");
      }

      const [resultMemory] = candidate.resultMemoryId
        ? await tx
            .select()
            .from(memories)
            .where(eq(memories.id, candidate.resultMemoryId))
            .limit(1)
            .for("update")
        : [];
      const [targetMemory] = candidate.targetMemoryId
        ? await tx
            .select()
            .from(memories)
            .where(eq(memories.id, candidate.targetMemoryId))
            .limit(1)
            .for("update")
        : [];
      const timestamp = new Date().toISOString();
      const [event] = await tx
        .insert(events)
        .values({
          projectId: candidate.projectId,
          actor: "user",
          kind: "memory_candidate.review_undone",
          payload: {
            candidateId: candidate.id,
            reviewAction: candidate.reviewAction,
            reviewEventId: candidate.reviewEventId,
            reason,
          },
        })
        .returning();

      let memory: typeof memories.$inferSelect | null = null;
      let restoredMemory: typeof memories.$inferSelect | null = null;
      if (candidate.reviewAction === "accept" || candidate.reviewAction === "replace") {
        if (!resultMemory) throw new Error("审核生成的记忆不存在，无法撤销");
        const [{ latestVersion }] = await tx
          .select({ latestVersion: max(memoryVersions.version) })
          .from(memoryVersions)
          .where(eq(memoryVersions.memoryId, resultMemory.id));
        if (Number(latestVersion ?? 0) !== candidate.resultVersion) {
          throw new Error("记忆已经再次更新，不能直接撤销较早的审核");
        }
        [memory] = await tx
          .update(memories)
          .set({ status: "archived", validUntil: timestamp, updatedAt: timestamp })
          .where(eq(memories.id, resultMemory.id))
          .returning();

        if (candidate.reviewAction === "replace") {
          if (!targetMemory) throw new Error("被替代的旧记忆不存在，无法撤销");
          [restoredMemory] = await tx
            .update(memories)
            .set({
              status: "active",
              validUntil: null,
              lastConfirmedAt: timestamp,
              updatedAt: timestamp,
            })
            .where(eq(memories.id, targetMemory.id))
            .returning();
        }
      }

      if (candidate.reviewAction === "merge") {
        if (!resultMemory || !candidate.resultVersion || candidate.resultVersion <= 1) {
          throw new Error("合并版本信息不完整，无法撤销");
        }
        const [{ latestVersion }] = await tx
          .select({ latestVersion: max(memoryVersions.version) })
          .from(memoryVersions)
          .where(eq(memoryVersions.memoryId, resultMemory.id));
        if (Number(latestVersion ?? 0) !== candidate.resultVersion) {
          throw new Error("记忆已经再次更新，不能直接撤销较早的合并");
        }
        const [previousVersion] = await tx
          .select()
          .from(memoryVersions)
          .where(
            and(
              eq(memoryVersions.memoryId, resultMemory.id),
              eq(memoryVersions.version, candidate.resultVersion - 1),
            ),
          )
          .limit(1);
        if (!previousVersion) throw new Error("找不到合并前的记忆版本");
        [memory] = await tx
          .update(memories)
          .set({
            subject: previousVersion.subject,
            statement: previousVersion.statement,
            importance: previousVersion.importance,
            confidence: previousVersion.confidence,
            sourceEventId: event.id,
            lastConfirmedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(memories.id, resultMemory.id))
          .returning();
        await tx.insert(memoryVersions).values({
          memoryId: resultMemory.id,
          version: candidate.resultVersion + 1,
          subject: previousVersion.subject,
          statement: previousVersion.statement,
          importance: previousVersion.importance,
          confidence: previousVersion.confidence,
          changeReason:
            reason || `撤销候选审核，恢复 v${previousVersion.version}`,
          sourceEventId: event.id,
        });
        restoredMemory = memory;
      }

      const [pendingCandidate] = await tx
        .update(memoryCandidates)
        .set({
          status: "pending",
          decisionReason: "",
          reviewAction: null,
          targetMemoryId: null,
          resultMemoryId: null,
          reviewEventId: null,
          resultVersion: null,
          reviewedAt: null,
        })
        .where(eq(memoryCandidates.id, candidate.id))
        .returning();

      return {
        event: asEvent(event),
        candidate: asCandidate(pendingCandidate),
        memory: memory ? asMemory(memory) : null,
        restoredMemory: restoredMemory ? asMemory(restoredMemory) : null,
      };
    });
  }

  async listMemories(
    options: { projectId?: string | null; status?: MemoryStatus } = {},
  ): Promise<MemoryRecord[]> {
    const db = getDatabase();
    const status = options.status ?? "active";
    const scopeCondition = options.projectId
      ? or(
          eq(memories.scope, "global"),
          and(
            eq(memories.scope, "project"),
            eq(memories.projectId, options.projectId),
          ),
        )
      : undefined;
    const rows = await db
      .select()
      .from(memories)
      .where(
        scopeCondition
          ? and(eq(memories.status, status), scopeCondition)
          : eq(memories.status, status),
      )
      .orderBy(desc(memories.importance), desc(memories.updatedAt));
    return rows.map(asMemory);
  }

  async listMemoryVersions(memoryId: string): Promise<MemoryVersionRecord[]> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.memoryId, memoryId))
      .orderBy(desc(memoryVersions.version));
    return rows.map(asVersion);
  }

  async restoreMemoryVersion(
    memoryId: string,
    version: number,
    reason = "",
  ): Promise<MemoryRestoreResult> {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [memory] = await tx
        .select()
        .from(memories)
        .where(eq(memories.id, memoryId))
        .limit(1)
        .for("update");
      if (!memory) throw new Error("记忆不存在");
      if (memory.status !== "active") {
        throw new Error("只能恢复当前有效记忆的历史版本");
      }
      const [targetVersion] = await tx
        .select()
        .from(memoryVersions)
        .where(
          and(
            eq(memoryVersions.memoryId, memoryId),
            eq(memoryVersions.version, version),
          ),
        )
        .limit(1);
      if (!targetVersion) throw new Error("目标版本不存在");
      const [{ latestVersion }] = await tx
        .select({ latestVersion: max(memoryVersions.version) })
        .from(memoryVersions)
        .where(eq(memoryVersions.memoryId, memoryId));
      if (Number(latestVersion ?? 0) === version) {
        throw new Error("目标版本已经是当前版本");
      }

      const timestamp = new Date().toISOString();
      const [event] = await tx
        .insert(events)
        .values({
          projectId: memory.projectId,
          actor: "user",
          kind: "memory.version_restored",
          payload: { memoryId, restoredFromVersion: version, reason },
        })
        .returning();
      const [restoredMemory] = await tx
        .update(memories)
        .set({
          subject: targetVersion.subject,
          statement: targetVersion.statement,
          importance: targetVersion.importance,
          confidence: targetVersion.confidence,
          sourceEventId: event.id,
          lastConfirmedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(memories.id, memoryId))
        .returning();
      const [restoredVersion] = await tx
        .insert(memoryVersions)
        .values({
          memoryId,
          version: Number(latestVersion ?? 0) + 1,
          subject: targetVersion.subject,
          statement: targetVersion.statement,
          importance: targetVersion.importance,
          confidence: targetVersion.confidence,
          changeReason: reason ? `恢复 v${version}：${reason}` : `恢复到 v${version}`,
          sourceEventId: event.id,
        })
        .returning();
      return {
        event: asEvent(event),
        memory: asMemory(restoredMemory),
        version: asVersion(restoredVersion),
        restoredFromVersion: version,
      };
    });
  }

  async saveContextSnapshot(bundle: ContextBundle): Promise<void> {
    const db = getDatabase();
    const selections = [
      ...bundle.globalContext,
      ...bundle.projectContext,
      ...bundle.relevantMemories,
    ];
    await db.transaction(async (tx) => {
      const [snapshot] = await tx
        .insert(contextSnapshots)
        .values({
          id: bundle.id,
          projectId: bundle.projectId,
          query: bundle.query,
          selectedMemoryIds: selections.map((selection) => selection.memory.id),
          sections: {
            globalContext: bundle.globalContext,
            projectContext: bundle.projectContext,
            relevantMemories: bundle.relevantMemories,
          },
          tokenBudget: bundle.tokenBudget,
          estimatedTokens: bundle.estimatedTokens,
        })
        .returning({ id: contextSnapshots.id });

      if (selections.length > 0) {
        await tx.insert(memoryUsageLogs).values(
          selections.map((selection, index) => ({
            memoryId: selection.memory.id,
            contextSnapshotId: snapshot.id,
            rank: index + 1,
            score: selection.score,
          })),
        );
      }
    });
  }
}
