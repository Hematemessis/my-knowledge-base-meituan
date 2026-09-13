"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentLibrary, DocumentPreview, type DocumentTarget } from "./document-library";
import type { DocumentVersion, Evidence } from "@/lib/documents/types";
import type { Conversation, ConversationMessage, ConversationSummary, WorkspaceMode } from "@/lib/conversations/types";

import type {
  ContextBundle,
  MemoryRecord,
  MemoryType,
} from "@/lib/memory/types";

type UploadedAttachment = {
  id: string;
  name: string;
  size: number;
  truncated: boolean;
  pageCount?: number;
};

type ChatResponse = {
  text: string;
  mode: "model" | "local";
  model: string | null;
  context: ContextBundle;
  usedMemories: MemoryRecord[];
  candidatesCreated: number;
  citations?: Evidence[];
  error?: string;
};

const typeLabels: Record<MemoryType, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  goal: "目标",
  workflow: "工作流",
  episode: "阶段记录",
};

const quickPrompts = [
  "根据我之前的决定，下一步该做什么？",
  "总结这个项目目前的重点和约束",
  "检查我的已有偏好和当前方案有没有冲突",
];
const documentPrompts = [
  "这份文档主要讲什么？哪些要求已确定，还有哪些问题没明确？",
  "提取资料中的关键结论，并标注出处",
  "这些资料中有哪些相互矛盾的说法？",
];

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function messageId() {
  return crypto.randomUUID();
}

export function AssistantWorkspace({
  projectId,
  onContextChange,
  onCandidatesCreated,
  onNotice,
  onRemember,
  onReview,
}: {
  projectId: string;
  onContextChange: (context: ContextBundle) => void;
  onCandidatesCreated: (count: number) => void;
  onNotice: (message: string) => void;
  onRemember: () => void;
  onReview: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentIds,setDocumentIds] = useState<string[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode | null>(null);
  const knowledgeOnly = workspaceMode === "documents";
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingSaved, setPendingSaved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const busy = sending || uploading || loading || pendingSaved;
  const [revision,setRevision] = useState(0);
  const [preview,setPreview] = useState<DocumentTarget | null>(null);
  const [uploadStatus,setUploadStatus] = useState<Array<{name:string; status:string}>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const refreshHistory = useCallback(async () => {
    const response = await fetch(`/api/conversations?projectId=${projectId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取历史对话失败");
    setConversations(data.conversations);
    setHistoryError("");
  }, [projectId]);

  const readConversation = useCallback(async (id: string): Promise<Conversation> => {
    const response = await fetch(`/api/conversations/${id}?projectId=${projectId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取对话失败");
    return data.conversation;
  }, [projectId]);

  const applyConversation = useCallback((conversation: Conversation) => {
    setConversationId(conversation.id);
    setWorkspaceMode(conversation.mode);
    setMessages(conversation.messages);
    setDocumentIds(conversation.documentIds);
    setPendingSaved(Boolean(conversation.pending));
    setHistoryError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = new URLSearchParams(window.location.search).get("conversation");
    void (async () => {
      try {
        await refreshHistory();
        if (id) {
          const conversation = await readConversation(id);
          if (!cancelled) applyConversation(conversation);
        }
      } catch (error) {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "读取历史对话失败");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [refreshHistory, readConversation, applyConversation]);

  useEffect(() => {
    if (!pendingSaved || sending || !conversationId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void readConversation(conversationId).then(conversation => {
        if (!cancelled) {
          applyConversation(conversation);
          if (!conversation.pending) void refreshHistory().catch(() => {});
        }
      }).catch(() => { if (!cancelled) setHistoryError("暂时无法读取回答，正在重连；问题保存在本机。"); });
    }, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pendingSaved, sending, conversationId, readConversation, applyConversation, refreshHistory]);

  function setConversationUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    window.history.replaceState(null, "", url);
  }

  async function openConversation(id: string) {
    if (busy) return;
    setLoading(true);
    try {
      applyConversation(await readConversation(id));
      setConversationUrl(id);
      setDraft(""); setAttachments([]); setUploadStatus([]); setHistoryOpen(false); setHistoryError("");
    } catch (error) { onNotice(error instanceof Error ? error.message : "读取对话失败"); }
    finally { setLoading(false); }
  }

  function startWorkspace(mode: WorkspaceMode | null, keepSelection = false) {
    if (busy) return;
    setWorkspaceMode(mode); setConversationId(null); setMessages([]); setDraft("");
    setAttachments([]); if (!keepSelection) setDocumentIds([]); setUploadStatus([]); setHistoryOpen(false);
    setConversationUrl(null); onNotice("");
    void refreshHistory().catch(error => setHistoryError(error.message));
  }
  useEffect(() => {
    if (threadRef.current && messages.length > 0) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  },[messages,sending]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const remaining = Math.max(0, 5 - attachments.length);
    const selected = Array.from(files).slice(0, remaining);
    if (!remaining) {
      onNotice("每轮最多上传 5 个文件。");
      return;
    }
    if (files.length > remaining) {
      onNotice(`本轮还可上传 ${remaining} 个文件，你选择了 ${files.length} 个。本次尚未上传，请减少选择后重试。`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    onNotice("");
    try {
      setUploadStatus(selected.map(file => ({name:file.name,status:"上传并解析中…"})));
      const outcomes = await Promise.allSettled(
        selected.map(async (file) => {
          const body = new FormData();
          body.append("file", file);
          body.append("projectId",projectId);
          const response = await fetch("/api/documents", {
            method: "POST",
            body,
          });
          const data = (await response.json()) as {
            error?: string;
            document?: DocumentVersion;
            truncated?: boolean;
            pageCount?: number;
          };
          if (!response.ok || !data.document) {
            throw new Error(data.error || `${file.name} 解析失败`);
          }
          return {
            id: data.document.id,
            name: file.name,
            size: file.size,
            truncated: data.document.truncated,
            pageCount: data.pageCount,
          };
        }),
      );
      const uploaded = outcomes.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      setUploadStatus(outcomes.map((result,index) => ({name:selected[index].name,
        status:result.status === "fulfilled" ? "已入库，可问答" : result.reason?.message || "上传失败，请重试"})));
      setAttachments((current) => [...current, ...uploaded]);
      if (uploaded.length) {
        setDocumentIds(current => [...new Set([...current,...uploaded.map(item => item.id)])].slice(0,20));
        setRevision(current => current+1);
      }
      onNotice(`已保存 ${uploaded.length} 个文件；${outcomes.length-uploaded.length} 个失败。成功的资料可以直接提问。`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "文件解析失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage() {
    const message = draft.trim();
    if (!message || busy || !workspaceMode) return;

    const currentAttachments = attachments;
    const previousMessages = messages;
    const id = conversationId ?? messageId();
    const userMessage: ConversationMessage = {
      id: messageId(),
      role: "user",
      content: message,
      attachments: currentAttachments.map(({ name, size }) => ({ name, size })),
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setAttachments([]);
    setSending(true);
    setConversationId(id);
    setConversationUrl(id);
    onNotice("");

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          conversationId: id,
          requestId: userMessage.id,
          uploadedFiles: userMessage.attachments,
          documentIds: knowledgeOnly ? documentIds : [],
          knowledgeOnly,
          message,
          history: previousMessages
            .filter((item) => item.content.trim() && !item.failed)
            .slice(-10)
            .map(({ role, content }) => ({ role, content:content.slice(0,8000) })),
        }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok) throw new Error(data.error || "回答失败，请稍后再试");

      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant",
          content: data.text,
          mode: data.mode,
          model: data.model,
          usedMemories: data.usedMemories,
          citations: data.citations,
        },
      ]);
      onContextChange(data.context);
      void refreshHistory().catch(error => setHistoryError(error.message));
      if (data.candidatesCreated > 0) {
        onCandidatesCreated(data.candidatesCreated);
        onNotice(`从本轮内容中发现 ${data.candidatesCreated} 条候选记忆，等待你确认。`);
      }
    } catch (error) {
      try {
        const saved = await readConversation(id);
        applyConversation(saved);
        // A dropped HTTP connection need not mean generation failed on the server.
        if (!saved.pending && saved.messages.at(-1)?.failed) setDraft(message);
      } catch {
        setMessages(current => [...current, { id: messageId(), role: "assistant",
          content: "连接失败，尚未确认本轮是否保存。请恢复连接后刷新历史对话，再重试。", failed: true }]);
        setDraft(message);
      }
      onNotice(error instanceof Error ? error.message : "回答失败，请稍后再试");
      void refreshHistory().catch(() => {});
    } finally {
      setSending(false);
    }
  }

  const historyList = <div className="conversation-list">
    {historyError ? <p role="alert">{historyError} <button type="button" onClick={() => void refreshHistory().catch(error => setHistoryError(error.message))}>重试</button></p> : null}
    {loading ? <p role="status">正在读取本机记录…</p> : !conversations.length ? <p className="history-empty">开始第一段对话后，它会自动保存在这里。</p> : conversations.map(item => (
      <button className="conversation-item" type="button" key={item.id} disabled={busy}
        aria-current={conversationId === item.id ? "true" : undefined} onClick={() => void openConversation(item.id)}>
        <span className="conversation-kind">{item.mode === "documents" ? "资料问答" : "项目助手"}</span>
        <strong>{item.title}</strong>
        <small>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {item.messageCount} 条消息</small>
      </button>
    ))}
  </div>;

  if (!workspaceMode) return (
    <section className="workspace-home" aria-labelledby="home-title">
      <div className="home-heading"><div><p className="section-label">个人工作空间 / 知识库</p>
      <h1 id="home-title">我的知识库</h1>
      <p className="home-intro">收藏你的资料，让每一次回顾都有据可循。</p></div>
      <button className="primary-upload" type="button" disabled={busy} onClick={()=>fileInputRef.current?.click()}>＋ 上传文件</button></div>
      <input ref={fileInputRef} className="visually-hidden" type="file" aria-label="从首页上传文件" multiple
        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm"
        onChange={event=>{const files=event.target.files; startWorkspace("documents"); void uploadFiles(files);}} />
      <div className="workspace-entry-grid">
        <button type="button" className="workspace-entry" disabled={loading} onClick={() => startWorkspace("documents")}>
          <span className="entry-icon" aria-hidden="true">✦</span><h2>和资料聊一聊</h2>
          <p>回顾项目、提取指标、对比方案。带着问题来，带着出处走。</p>
          <strong className="entry-action">开始资料问答 ↗</strong>
        </button>
        <button type="button" className="workspace-entry" disabled={loading} onClick={() => startWorkspace("project")}>
          <span className="entry-icon" aria-hidden="true">◇</span><h2>接着上次的想法</h2>
          <p>带上已确认的偏好、决定和项目背景，继续推进手头的事。</p>
          <strong className="entry-action">打开项目助手 ↗</strong>
        </button>
      </div>
      <DocumentLibrary projectId={projectId} revision={revision} selected={documentIds} onSelect={setDocumentIds}
        expanded onAsk={()=>startWorkspace("documents",true)} onPreview={setPreview}
        onChanged={()=>setRevision(current=>current+1)} onNotice={onNotice} />
      {preview ? <DocumentPreview key={`${preview.id}-${preview.version}-${preview.chunkId}`} projectId={projectId} target={preview} onClose={()=>setPreview(null)} /> : null}
      <p className="home-storage-note">资料与对话存于本机 · 问答所需内容会发送至已配置的 AI 模型 · 重要记忆须经你确认</p>
      <div className="history-heading"><h2>接着上次聊</h2><span>刷新页面、重启服务后仍可继续</span></div>
      {historyList}
    </section>
  );

  return (
    <section className="assistant-view" aria-labelledby="assistant-title">
      <div className="assistant-heading">
        <div>
          <button className="workspace-back" type="button" disabled={busy} onClick={() => startWorkspace(null)}>← 返回首页</button>
          <h1 id="assistant-title">{knowledgeOnly ? "问我的资料" : "继续我的项目"}</h1>
          <p>{knowledgeOnly ? "上传或勾选资料 → 提问 → 点击引用核对原文。没有依据时会明确说明。" : "说说进展或直接提问。AI 会参考已确认背景，新发现的记忆需要你审核。"}</p>
        </div>
        <div className="workspace-actions">
          <button type="button" disabled={busy} onClick={() => startWorkspace(workspaceMode)}>＋ 新对话</button>
          <button type="button" disabled={busy} aria-expanded={historyOpen} onClick={() => {
            setHistoryOpen(!historyOpen); void refreshHistory().catch(error => setHistoryError(error.message));
          }}>历史对话</button>
        </div>
      </div>

      {historyOpen ? <div className="history-panel">{historyList}</div> : null}
      {knowledgeOnly ? <DocumentLibrary projectId={projectId} revision={revision} selected={documentIds}
        onSelect={setDocumentIds}
        onPreview={setPreview} onChanged={() => setRevision(current => current+1)} onNotice={onNotice} /> :
        <div className="project-context-guide"><span>想让下次的 AI 也记得？</span>
          <button type="button" onClick={onRemember}>记住一件事</button>
          <button type="button" onClick={onReview}>审核待确认记忆</button>
        </div>}
      {preview ? <DocumentPreview key={`${preview.id}-${preview.version}-${preview.chunkId}`}
        projectId={projectId} target={preview} onClose={() => setPreview(null)} /> : null}

      <div ref={threadRef} className="chat-thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="assistant-orb" aria-hidden="true">K</div>
            <h2>{knowledgeOnly ? "想从资料里找到什么？" : "不必从头介绍，接着往下聊"}</h2>
            <p>{knowledgeOnly ? "已有资料可以直接提问，也可以展开资料库限定范围，或上传新的文档。" : "你可以先说目标、已做的决定或最新进展；确认后的背景，下次对话也能用。"}</p>
            <div className="quick-prompts">
              {(knowledgeOnly ? documentPrompts : quickPrompts).map((prompt) => (
                <button type="button" key={prompt} onClick={() => setDraft(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">
                {message.role === "assistant" ? "K" : "你"}
              </div>
              <div className="message-body">
                <div className="message-meta">
                  <strong>{message.role === "assistant" ? "Knowledge Context" : "你"}</strong>
                  {message.role === "assistant" && message.mode ? (
                    <span className={`answer-mode ${message.mode}`}>
                      {message.mode === "model" ? message.model || "AI 回答" : "本地模式"}
                    </span>
                  ) : null}
                </div>
                <p>{message.content.split(/(\[\d+\])/g).map((part,index) => {
                  const source = message.citations?.find(item => `[${item.citation}]` === part);
                  return source ? <button className="citation-link" type="button" key={index}
                    aria-label={`查看引用 ${source.citation}：${source.name}`}
                    onClick={() => setPreview({id:source.documentId,version:source.version,chunkId:source.id})}>{part}</button> : part;
                })}</p>
                {message.citations?.length ? <details className="message-sources">
                  <summary>查看 {message.citations.length} 处原文依据</summary>
                  {message.citations.map(source => <button className="source-card" type="button" key={source.id}
                    onClick={() => setPreview({id:source.documentId,version:source.version,chunkId:source.id})}>
                    <strong>[{source.citation}] {source.name} · v{source.version} · 片段 {source.ordinal}</strong>
                    <small>{new Date(source.updatedAt).toLocaleString("zh-CN")}</small>
                    <span>{source.text.slice(0,200)}{source.text.length > 200 ? "…" : ""}</span>
                  </button>)}
                </details> : null}
                {message.failed ? <button className="retry-message" type="button" disabled={busy} onClick={() => {
                  const index = messages.findIndex(item => item.id === message.id);
                  const question = messages.slice(0, index).findLast(item => item.role === "user");
                  if (question) setDraft(question.content);
                }}>把问题放回输入框重试</button> : null}
                {message.attachments?.length ? (
                  <div className="message-files">
                    {message.attachments.map((file) => (
                      <span key={`${message.id}-${file.name}`}>▤ {file.name} · {readableSize(file.size)}</span>
                    ))}
                  </div>
                ) : null}
                {message.usedMemories?.length ? (
                  <details className="message-sources">
                    <summary>本轮使用了 {message.usedMemories.length} 条已确认记忆</summary>
                    <ul>
                      {message.usedMemories.map((memory) => (
                        <li key={memory.id}>
                          <span>{typeLabels[memory.type]}</span>
                          {memory.statement}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </article>
          ))
        )}
        {sending || pendingSaved ? (
          <article className="chat-message assistant pending-message">
            <div className="message-avatar" aria-hidden="true">K</div>
            <div className="message-body">
              <strong>{pendingSaved ? "问题已保存，正在等待回答…" : knowledgeOnly ? "正在查找资料并核对出处…" : "正在结合已确认记忆思考…"}</strong>
              <span className="typing-dots" aria-label="正在生成"><i /><i /><i /></span>
            </div>
          </article>
        ) : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <div className="knowledge-mode">
          <span>{knowledgeOnly ? "仅依据资料回答" : "结合已确认记忆"}</span>
          <small>{knowledgeOnly ? documentIds.length ? `已限定 ${documentIds.length} 份资料` : "检索当前项目全部资料" : "个人助手 · 结合已确认记忆"}</small>
          {knowledgeOnly && documentIds.length > 0 ? <button className="workspace-back" type="button" disabled={busy}
            onClick={() => { setDocumentIds([]); setAttachments([]); }}>改为全部资料</button> : null}
        </div>
        {uploadStatus.length ? <details className="upload-status" open={uploading}>
          <summary>{uploading ? "正在导入资料…" : "查看导入结果"}</summary>
          {uploadStatus.map((item,index) => <p key={index}>{item.name}：{item.status}</p>)}
        </details> : null}
        {attachments.length ? (
          <div className="attachment-row">
            {attachments.map((attachment) => (
              <span className="attachment-chip" key={attachment.id}>
                <span aria-hidden="true">▤</span>
                <span>
                  <strong>{attachment.name}</strong>
                  <small>
                    {readableSize(attachment.size)}
                    {attachment.pageCount ? ` · ${attachment.pageCount} 页` : ""}
                    {attachment.truncated ? " · 已截取" : ""}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${attachment.name}`}
                  onClick={() => {
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    );
                    setDocumentIds(current => current.filter(id => id !== attachment.id));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          aria-label="给知识库助手发送消息"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          rows={3}
          maxLength={20_000}
          placeholder={knowledgeOnly ? "问问资料里的内容，例如：这个方案的限制是什么？" : "说说进展、你的决定，或需要 AI 帮忙推进的事情…"}
        />
        <div className="chat-composer-footer">
          {knowledgeOnly ? <div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              aria-label="上传文件"
              accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm"
              multiple
              onChange={(event) => void uploadFiles(event.target.files)}
            />
            <button
              type="button"
              className="attach-button"
              disabled={busy || attachments.length >= 5}
              onClick={() => fileInputRef.current?.click()}
            >
              <span aria-hidden="true">＋</span>
              {uploading ? "正在读取…" : "上传文件"}
            </button>
            <small>PDF、Word、文本 · 每轮最多 5 份 · 单份 10 MB</small>
          </div> : <small>聊天自动保存；长期记忆须经你确认</small>}
          <button
            type="submit"
            className="send-button"
            disabled={!draft.trim() || busy}
          >
            {sending ? "回答中…" : "发送"}
            <span aria-hidden="true">↑</span>
          </button>
        </div>
      </form>
    </section>
  );
}
