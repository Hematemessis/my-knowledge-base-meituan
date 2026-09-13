"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEMO_PROJECT_ID,
  type CandidateReviewAction,
  type CandidateReviewItem,
  type MemoryCandidateRecord,
  type MemoryScope,
  type MemoryType,
  type StorageMode,
} from "@/lib/memory/types";

const actionLabels: Record<Exclude<CandidateReviewAction, "reject">, string> = {
  accept: "确认新增",
  merge: "合并为新版本",
  replace: "替代旧记忆",
};

const typeLabels: Record<MemoryType, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  goal: "目标",
  workflow: "工作流",
  episode: "阶段记录",
};

export function CandidateQueue({
  onMemoryChanged,
  revision,
}: {
  onMemoryChanged: () => Promise<void>;
  revision?: string;
}) {
  const [reviews, setReviews] = useState<CandidateReviewItem[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [scope, setScope] = useState<MemoryScope>("project");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<
    Record<string, { statement: string; importance: number }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [captureOpen, setCaptureOpen] = useState(true);
  const captureInitialized = useRef(false);
  const [lastReviewedCandidateId, setLastReviewedCandidateId] = useState<
    string | null
  >(null);
  const [storageMode, setStorageMode] = useState<StorageMode>("memory");

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/memory-candidates?projectId=${DEMO_PROJECT_ID}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("读取候选记忆失败");
    const data = (await response.json()) as {
      storageMode: StorageMode;
      reviews: CandidateReviewItem[];
      lastReviewedCandidateId: string | null;
    };
    setStorageMode(data.storageMode);
    setReviews(data.reviews);
    setLastReviewedCandidateId(data.lastReviewedCandidateId);
    if (!captureInitialized.current) {
      setCaptureOpen(data.reviews.length === 0);
      captureInitialized.current = true;
    }
    setEdits((current) => {
      const next = { ...current };
      for (const review of data.reviews) {
        if (!next[review.candidate.id]) {
          next[review.candidate.id] = {
            statement: review.candidate.statement,
            importance: review.candidate.importance,
          };
        }
      }
      return next;
    });
    setTargets((current) => {
      const next = { ...current };
      for (const review of data.reviews) {
        if (!next[review.candidate.id] && review.possibleMatches[0]) {
          next[review.candidate.id] = review.possibleMatches[0].memory.id;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      setMessage(error instanceof Error ? error.message : "初始化失败");
    });
  }, [refresh, revision]);

  async function handleExtract(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceText.trim()) return;
    setBusyId("extract");
    setMessage("");
    try {
      const response = await fetch("/api/memory-candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: scope === "project" ? DEMO_PROJECT_ID : null,
          sourceText,
          scope,
        }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        extractionMode?: "heuristic" | "model";
      };
      if (!response.ok) throw new Error(data.error || "提取候选记忆失败");
      setSourceText("");
      setCaptureOpen(false);
      setMessage(data.message || "候选记忆已生成。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提取候选记忆失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReview(
    review: CandidateReviewItem,
    action: CandidateReviewAction,
  ) {
    const targetMemoryId = targets[review.candidate.id] ?? null;
    if ((action === "merge" || action === "replace") && !targetMemoryId) {
      setMessage("请先选择要更新的已有记忆。");
      return;
    }
    setBusyId(review.candidate.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/memory-candidates/${review.candidate.id}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            targetMemoryId:
              action === "merge" || action === "replace" ? targetMemoryId : null,
            reason:
              action === "reject"
                ? "用户拒绝候选记忆"
                : `用户选择${action === "accept" ? "新增" : action === "merge" ? "合并" : "替代"}`,
            patch: edits[review.candidate.id],
          }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        candidate?: MemoryCandidateRecord;
      };
      if (!response.ok) throw new Error(data.error || "处理候选记忆失败");
      setLastReviewedCandidateId(data.candidate?.id ?? review.candidate.id);
      setMessage(
        action === "reject"
          ? "候选记忆已拒绝，不会进入长期上下文。"
          : action === "merge"
            ? "已更新现有记忆，并保留历史版本。"
            : action === "replace"
              ? "新记忆已生效，旧记忆已标记为被替代。"
              : "候选记忆已确认并生效。",
      );
      setCaptureOpen(false);
      await Promise.all([refresh(), onMemoryChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "处理候选记忆失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUndoLastReview() {
    if (!lastReviewedCandidateId) return;
    setBusyId(lastReviewedCandidateId);
    try {
      const response = await fetch(
        `/api/memory-candidates/${lastReviewedCandidateId}/undo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "用户撤销上次审核" }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "撤销审核失败");
      setLastReviewedCandidateId(null);
      setMessage("上次审核已撤销，候选内容重新回到待确认队列。");
      await Promise.all([refresh(), onMemoryChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销审核失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="content-view candidate-view" aria-labelledby="candidate-title">
      <div className="view-heading">
        <div>
          <p className="section-label">待确认</p>
          <h1 id="candidate-title">这些内容要记住吗？</h1>
          <p>新内容会先停在这里。只有经过你的确认，才会进入长期记忆。</p>
        </div>
        <span className="candidate-count">{reviews.length} 条待确认</span>
      </div>

      {captureOpen ? (
        <form className="candidate-capture" onSubmit={handleExtract}>
          <div className="capture-heading">
            <strong>从新内容中提取</strong>
            <span>{storageMode === "postgres" ? "保存到数据库" : storageMode === "sqlite" ? "已保存到本机" : "正在连接存储…"}</span>
          </div>
          <label htmlFor="candidate-source">对话、会议结论或项目说明</label>
          <textarea
            id="candidate-source"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="例如：我们决定先做记忆版本管理。以后每次修改决策都要保留历史。"
            rows={3}
            maxLength={10_000}
          />
          <div className="capture-actions">
            <label>
              记忆范围
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as MemoryScope)}
              >
                <option value="project">当前项目</option>
                <option value="global">所有项目</option>
              </select>
            </label>
            <button type="submit" disabled={busyId !== null || !sourceText.trim()}>
              找出值得记住的内容
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="reopen-capture"
          onClick={() => setCaptureOpen(true)}
        >
          <span aria-hidden="true">＋</span>
          继续从新内容中提取
        </button>
      )}

      {message || lastReviewedCandidateId ? (
        <div className="status-row" role="status">
          <p className="status-message">
            {message || "最近一次候选审核仍可撤销。"}
          </p>
          {lastReviewedCandidateId ? (
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void handleUndoLastReview()}
            >
              撤销上次审核
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="candidate-list">
        {reviews.length === 0 ? (
          <div className="empty-state compact-empty candidate-empty">
            <span aria-hidden="true">✓</span>
            <strong>现在没有需要确认的内容</strong>
            <p>从上方粘贴一段内容，系统会帮你找出值得长期记住的信息。</p>
          </div>
        ) : (
          reviews.map((review) => {
            const selectedTargetId =
              targets[review.candidate.id] ?? review.possibleMatches[0]?.memory.id;
            const selectedMatch = review.possibleMatches.find(
              (match) => match.memory.id === selectedTargetId,
            );
            const primaryAction = review.suggestedAction;
            const alternativeActions = (
              ["accept", "merge", "replace"] as const
            ).filter((action) => action !== primaryAction);
            return (
              <article className="candidate-item" key={review.candidate.id}>
                <div className="candidate-heading">
                  <div className="memory-meta">
                    <span>{typeLabels[review.candidate.type]}</span>
                    <span>{review.candidate.scope === "global" ? "全局" : "项目"}</span>
                  </div>
                  <span className="suggestion-badge">
                    建议：{actionLabels[review.suggestedAction]}
                  </span>
                </div>
                <label className="candidate-editor">
                  记忆内容
                  <textarea
                    value={
                      edits[review.candidate.id]?.statement ??
                      review.candidate.statement
                    }
                    onChange={(event) =>
                      setEdits((current) => ({
                        ...current,
                        [review.candidate.id]: {
                          statement: event.target.value,
                          importance:
                            current[review.candidate.id]?.importance ??
                            review.candidate.importance,
                        },
                      }))
                    }
                    rows={2}
                    minLength={3}
                    maxLength={2_000}
                  />
                </label>
                <label className="candidate-importance">
                  <span>重要性</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={
                      edits[review.candidate.id]?.importance ??
                      review.candidate.importance
                    }
                    onInput={(event) => {
                      const nextImportance = Number(event.currentTarget.value);
                      setEdits((current) => ({
                        ...current,
                        [review.candidate.id]: {
                          statement:
                            current[review.candidate.id]?.statement ??
                            review.candidate.statement,
                          importance: nextImportance,
                        },
                      }));
                    }}
                  />
                  <strong>
                    {edits[review.candidate.id]?.importance ??
                      review.candidate.importance}
                  </strong>
                  <small>识别把握 {Math.round(review.candidate.confidence * 100)}%</small>
                </label>

                {review.possibleMatches.length > 0 ? (
                  <div className="conflict-box">
                    <label>
                      可能与这条已有记忆重复
                      <select
                        value={selectedTargetId}
                        onChange={(event) =>
                          setTargets((current) => ({
                            ...current,
                            [review.candidate.id]: event.target.value,
                          }))
                        }
                      >
                        {review.possibleMatches.map((match) => (
                          <option key={match.memory.id} value={match.memory.id}>
                            {match.memory.statement}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedMatch ? (
                      <small>
                        {selectedMatch.reasons.join(" · ")} · 匹配度 {Math.round(selectedMatch.similarity * 100)}%
                      </small>
                    ) : null}
                  </div>
                ) : (
                  <p className="no-conflict">没有发现重复内容，可以直接记住。</p>
                )}

                <div className="candidate-actions">
                  <button
                    type="button"
                    className="recommended candidate-primary-action"
                    disabled={
                      busyId !== null ||
                      ((primaryAction === "merge" || primaryAction === "replace") &&
                        review.possibleMatches.length === 0)
                    }
                    onClick={() => void handleReview(review, primaryAction)}
                  >
                    {busyId === review.candidate.id
                      ? "正在处理…"
                      : actionLabels[primaryAction]}
                  </button>
                  <details className="candidate-more-actions">
                    <summary>其他处理</summary>
                    <div>
                      {alternativeActions.map((action) => (
                        <button
                          type="button"
                          key={action}
                          disabled={
                            busyId !== null ||
                            ((action === "merge" || action === "replace") &&
                              review.possibleMatches.length === 0)
                          }
                          onClick={() => void handleReview(review, action)}
                        >
                          {actionLabels[action]}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="reject"
                        disabled={busyId !== null}
                        onClick={() => void handleReview(review, "reject")}
                      >
                        忽略这条
                      </button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
