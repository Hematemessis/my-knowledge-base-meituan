"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AssistantWorkspace } from "@/components/assistant-workspace";
import { CandidateQueue } from "@/components/candidate-queue";
import {
  DEMO_PROJECT_ID,
  memoryTypes,
  type ContextBundle,
  type ContextSelection,
  type MemoryRecord,
  type MemoryScope,
  type MemoryType,
  type MemoryVersionRecord,
  type StorageMode,
} from "@/lib/memory/types";

const typeLabels: Record<MemoryType, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  goal: "目标",
  workflow: "工作流",
  episode: "阶段记录",
};

function contextSelections(context: ContextBundle | null): ContextSelection[] {
  if (!context) return [];
  return [
    ...context.globalContext,
    ...context.projectContext,
    ...context.relevantMemories,
  ];
}

export function MemoryWorkbench() {
  const [view, setView] = useState<"context" | "candidates">("context");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [storageMode, setStorageMode] = useState<StorageMode>("memory");
  const [context, setContext] = useState<ContextBundle | null>(null);
  const [statement, setStatement] = useState("");
  const [memoryType, setMemoryType] = useState<MemoryType | "auto">("auto");
  const [scope, setScope] = useState<MemoryScope>("project");
  const [importance, setImportance] = useState(85);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
  const [versionsByMemory, setVersionsByMemory] = useState<
    Record<string, MemoryVersionRecord[]>
  >({});
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [memoryComposerOpen, setMemoryComposerOpen] = useState(false);
  const [pendingHint, setPendingHint] = useState(0);

  const refreshMemories = useCallback(async () => {
    const response = await fetch(`/api/memories?projectId=${DEMO_PROJECT_ID}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("读取记忆失败");
    const data = (await response.json()) as {
      storageMode: StorageMode;
      memories: MemoryRecord[];
    };
    setStorageMode(data.storageMode);
    setMemories(data.memories);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshMemories().catch((error) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "初始化失败");
      }
    });
    if (window.matchMedia("(max-width: 820px)").matches) {
      setMemoryPanelOpen(false);
    }
    return () => {
      cancelled = true;
    };
  }, [refreshMemories]);

  const selectedIds = useMemo(
    () => new Set(contextSelections(context).map((item) => item.memory.id)),
    [context],
  );

  async function handleCreateMemory(event: React.FormEvent) {
    event.preventDefault();
    if (!statement.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: scope === "project" ? DEMO_PROJECT_ID : null,
          scope,
          type: memoryType === "auto" ? undefined : memoryType,
          subject: "Knowledge Context V2",
          statement,
          importance,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        classification?: { type: MemoryType; mode: "model" | "heuristic" | "manual" };
      };
      if (!response.ok) throw new Error(data.error || "保存记忆失败");
      setStatement("");
      setMemoryComposerOpen(false);
      setMemoryType("auto");
      const classifiedLabel = data.classification
        ? typeLabels[data.classification.type]
        : "合适类型";
      setMessage(
        memoryType === "auto"
          ? `AI 已归类为「${classifiedLabel}」并记住，你仍可在记忆中检查。`
          : `已按「${classifiedLabel}」保存，并保留第一个版本。`,
      );
      await refreshMemories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存记忆失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadVersions(memoryId: string) {
    const response = await fetch(`/api/memories/${memoryId}/versions`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("读取版本历史失败");
    const data = (await response.json()) as { versions: MemoryVersionRecord[] };
    setVersionsByMemory((current) => ({ ...current, [memoryId]: data.versions }));
    return data.versions;
  }

  async function handleToggleVersions(memoryId: string) {
    if (expandedMemoryId === memoryId) {
      setExpandedMemoryId(null);
      return;
    }
    setExpandedMemoryId(memoryId);
    if (versionsByMemory[memoryId]) return;
    try {
      await loadVersions(memoryId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取版本历史失败");
    }
  }

  async function handleRestoreVersion(memoryId: string, version: number) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/memories/${memoryId}/versions/${version}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: `用户恢复历史版本 v${version}` }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "恢复历史版本失败");
      await Promise.all([refreshMemories(), loadVersions(memoryId)]);
      setMessage(`已恢复 v${version}，旧版本仍然完整保留。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复历史版本失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">K</div>
          <div>
            <strong>Knowledge Context</strong>
            <span className="topbar-subtitle">个人知识工作台</span>
          </div>
        </div>

        <nav className="mobile-view-switch" aria-label="主要页面">
          <button
            type="button"
            aria-current={view === "context" ? "page" : undefined}
            onClick={() => setView("context")}
          >
            AI 工作区
          </button>
          <button
            type="button"
            aria-current={view === "candidates" ? "page" : undefined}
            onClick={() => setView("candidates")}
          >
            待确认{pendingHint ? ` ${pendingHint}` : ""}
          </button>
        </nav>

        <div className="topbar-actions">
          <span className={`storage-badge ${storageMode}`}>
            {storageMode === "postgres" ? "记忆已存数据库" : storageMode === "sqlite" ? "记忆已存本机" : "正在连接存储…"}
          </span>
          <button
            type="button"
            className="memory-toggle"
            aria-label={`已确认记忆 ${memories.length} 条`}
            aria-expanded={memoryPanelOpen}
            onClick={() => setMemoryPanelOpen((current) => !current)}
          >
            <span>记忆</span>
            <strong>{memories.length}</strong>
          </button>
        </div>
      </header>

      <div
        className={`workspace-grid ${railCollapsed ? "rail-collapsed" : ""} ${memoryPanelOpen ? "" : "drawer-closed"}`}
      >
        <aside className="project-rail">
          <div className="rail-project">
            <span className="project-avatar" aria-hidden="true">KC</span>
            <div className="rail-copy">
              <small>PERSONAL WORKSPACE</small>
              <strong>我的工作空间</strong>
            </div>
          </div>

          <nav className="rail-nav" aria-label="项目页面">
            <p className="rail-copy rail-section-label">工作空间</p>
            <button
              type="button"
              aria-label="AI 工作区"
              aria-current={view === "context" ? "page" : undefined}
              onClick={() => setView("context")}
            >
              <span className="nav-mark" aria-hidden="true">✦</span>
              <span className="rail-copy">知识库与 AI</span>
            </button>
            <button type="button" aria-label="查看已确认记忆" onClick={()=>setMemoryPanelOpen(true)}>
              <span className="nav-mark" aria-hidden="true">▧</span><span className="rail-copy">已确认记忆</span>
            </button>
            <button type="button" aria-label="新增一条记忆" onClick={()=>{setMemoryPanelOpen(true);setMemoryComposerOpen(true);}}>
              <span className="nav-mark" aria-hidden="true">＋</span><span className="rail-copy">记住一件事</span>
            </button>
            <button
              type="button"
              aria-label="待确认记忆"
              aria-current={view === "candidates" ? "page" : undefined}
              onClick={() => {
                setView("candidates");
                setPendingHint(0);
              }}
            >
              <span className="nav-mark" aria-hidden="true">✓</span>
              <span className="rail-copy">
                待确认记忆{pendingHint ? ` · ${pendingHint}` : ""}
              </span>
            </button>
          </nav>

          <div className="rail-footer">
            <div className="rail-stage rail-copy">
              <span>我的知识库</span>
              <strong>有出处，也有记忆</strong>
              <small>资料找答案，记忆接着用</small>
            </div>
            <button
              type="button"
              className="rail-collapse"
              aria-label={railCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={() => setRailCollapsed((current) => !current)}
            >
              {railCollapsed ? "›" : "‹"}
            </button>
          </div>
        </aside>

        <section className="workspace-main">
          {message ? (
            <div className="global-notice" role="status">
              <span aria-hidden="true">✓</span>
              {message}
              <button type="button" aria-label="关闭提示" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          ) : null}

          <div className="workspace-view-slot" hidden={view !== "context"}>
            <AssistantWorkspace
              projectId={DEMO_PROJECT_ID}
              onContextChange={setContext}
              onCandidatesCreated={(count) =>
                setPendingHint((current) => current + count)
              }
              onNotice={setMessage}
              onRemember={() => { setMemoryPanelOpen(true); setMemoryComposerOpen(true); }}
              onReview={() => { setView("candidates"); setPendingHint(0); }}
            />
          </div>
          <div className="workspace-view-slot" hidden={view !== "candidates"}>
            <CandidateQueue
              revision={`${pendingHint}-${view}`}
              onMemoryChanged={async () => {
                setVersionsByMemory({});
                await refreshMemories();
              }}
            />
          </div>
        </section>

        {memoryPanelOpen ? (
          <>
            <button
              type="button"
              className="drawer-scrim"
              aria-label="关闭记忆面板"
              onClick={() => setMemoryPanelOpen(false)}
            />
            <aside className="memory-panel" aria-labelledby="memory-title">
              <div className="memory-panel-heading">
                <div>
                  <p className="section-label">你的记忆</p>
                  <div className="memory-title-row">
                    <h2 id="memory-title">已确认记忆</h2>
                    <span>{memories.length}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="drawer-close"
                  aria-label="收起记忆面板"
                  onClick={() => setMemoryPanelOpen(false)}
                >
                  ×
                </button>
              </div>

              <button
                type="button"
                className="new-memory-button"
                aria-expanded={memoryComposerOpen}
                onClick={() => setMemoryComposerOpen((current) => !current)}
              >
                <span aria-hidden="true">＋</span>
                {memoryComposerOpen ? "收起" : "记住一件事"}
              </button>

              {memoryComposerOpen ? (
                <form className="memory-form" onSubmit={handleCreateMemory}>
                  <label htmlFor="memory-statement">希望系统长期记住什么？</label>
                  <textarea
                    id="memory-statement"
                    value={statement}
                    onChange={(event) => setStatement(event.target.value)}
                    placeholder="例如：这个项目优先保证数据可迁移。"
                    rows={3}
                    maxLength={2_000}
                    autoFocus
                  />
                  <div className="form-row">
                    <label>
                      类型
                      <select
                        value={memoryType}
                        onChange={(event) =>
                          setMemoryType(event.target.value as MemoryType | "auto")
                        }
                      >
                        <option value="auto">✦ AI 自动识别（推荐）</option>
                        <optgroup label="手动指定">
                          {memoryTypes.map((type) => (
                            <option key={type} value={type}>{typeLabels[type]}</option>
                          ))}
                        </optgroup>
                      </select>
                      <small className="field-hint">
                        {memoryType === "auto" ? "保存时自动判断，可随时检查" : "你已手动指定类型"}
                      </small>
                    </label>
                    <label>
                      范围
                      <select
                        value={scope}
                        onChange={(event) => setScope(event.target.value as MemoryScope)}
                      >
                        <option value="project">当前项目</option>
                        <option value="global">所有项目</option>
                      </select>
                    </label>
                  </div>
                  <label className="importance-label">
                    <span>重要性</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={importance}
                      onChange={(event) => setImportance(Number(event.target.value))}
                    />
                    <strong>{importance}</strong>
                  </label>
                  <button type="submit" disabled={busy || !statement.trim()}>
                    确认并记住
                  </button>
                </form>
              ) : null}

              <div className="memory-list">
                {memories.map((memory) => (
                  <article
                    className={`memory-item ${selectedIds.has(memory.id) ? "selected" : ""}`}
                    key={memory.id}
                  >
                    <div className="memory-item-heading">
                      <div className="memory-meta">
                        <span>{typeLabels[memory.type]}</span>
                        <span>{memory.scope === "global" ? "所有项目" : "当前项目"}</span>
                      </div>
                      {selectedIds.has(memory.id) ? (
                        <span className="in-use-badge">本次已使用</span>
                      ) : null}
                    </div>
                    <p>{memory.statement}</p>
                    <div className="memory-item-footer">
                      <small>重要性 {memory.importance}</small>
                      <button type="button" onClick={() => void handleToggleVersions(memory.id)}>
                        {expandedMemoryId === memory.id ? "收起版本" : "查看版本"}
                      </button>
                    </div>
                    {expandedMemoryId === memory.id ? (
                      <ol className="version-list">
                        {(versionsByMemory[memory.id] ?? []).map((version, index) => (
                          <li key={version.id}>
                            <div>
                              <strong>v{version.version}</strong>
                              {index === 0 ? <em>当前</em> : null}
                            </div>
                            <span>{version.statement}</span>
                            <small>{version.changeReason || "内容更新"}</small>
                            {index > 0 ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleRestoreVersion(memory.id, version.version)}
                              >
                                恢复这个版本
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </article>
                ))}
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </main>
  );
}
