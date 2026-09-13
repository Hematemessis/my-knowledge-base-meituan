"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSummary, DocumentVersion } from "@/lib/documents/types";

export type DocumentTarget = { id: string; version?: number; chunkId?: string };

export function DocumentPreview({projectId,target,onClose}: {
  projectId:string; target:DocumentTarget; onClose:()=>void;
}) {
  const [document,setDocument] = useState<DocumentVersion | null>(null);
  const [version,setVersion] = useState(target.version);
  const [error,setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); },[]);
  useEffect(() => {
    let cancelled = false;
    setDocument(null); setError("");
    void fetch(`/api/documents/${target.id}?projectId=${projectId}${version ? `&version=${version}` : ""}`,{cache:"no-store"})
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!cancelled) setDocument(data.document);
      }).catch(error => { if (!cancelled) setError(error.message || "读取失败"); });
    return () => { cancelled = true; };
  },[projectId,target.id,version]);
  useEffect(() => {
    if (document && target.chunkId) {
      dialog.current?.querySelector(`[data-chunk="${target.chunkId}"]`)?.scrollIntoView({block:"center"});
    }
  },[document,target.chunkId]);
  return <dialog ref={dialog} className="document-dialog" onCancel={onClose} aria-label="文档原文">
    <div className="document-dialog-heading">
      <div><small>资料原文 · 解析后的文字</small><h2>{document?.name || "读取文档"}</h2></div>
      <button type="button" onClick={onClose} aria-label="关闭原文">×</button>
    </div>
    {error ? <p role="alert">{error}</p> : !document ? <p role="status">正在读取…</p> : <>
      <div className="document-version-bar">
        <label>版本 <select value={document.version} onChange={e => setVersion(Number(e.target.value))}>
          {document.versions.map(item => <option key={item.version} value={item.version}>v{item.version} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</option>)}
        </select></label>
        <a href={`/api/documents/${document.id}?projectId=${projectId}&version=${document.version}&download=1`}>下载此版原文件</a>
      </div>
      <p className="document-note">定位以解析片段为准；表格布局可能简化。{document.truncated ? "本文超过解析上限，目前仅保存前 100,000 字符供检索，原文件完整保留。" : ""}</p>
      {document.chunks.map(chunk => <section key={chunk.id} data-chunk={chunk.id}
        className={`document-chunk ${chunk.id === target.chunkId ? "highlighted" : ""}`}>
        <small>片段 {chunk.ordinal} · 字符 {chunk.start + 1}–{chunk.end}</small>
        <p>{chunk.text}</p>
      </section>)}
    </>}
  </dialog>;
}

export function DocumentLibrary({projectId,revision,selected,onSelect,onPreview,onChanged,onNotice,expanded=false,onAsk}: {
  projectId:string; revision:number; selected:string[]; onSelect:(ids:string[])=>void;
  onPreview:(target:DocumentTarget)=>void; onChanged:()=>void; onNotice:(message:string)=>void;
  expanded?:boolean; onAsk?:()=>void;
}) {
  const [documents,setDocuments] = useState<DocumentSummary[]>([]);
  const [search,setSearch] = useState("");
  const [format,setFormat] = useState("all");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [replace,setReplace] = useState<string | null>(null);
  const [deleting,setDeleting] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/documents?projectId=${projectId}`,{cache:"no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取资料失败");
    setDocuments(data.documents); setError("");
  },[projectId]);
  useEffect(() => { void refresh().catch(error => setError(error.message)); },[refresh,revision]);

  async function update(file?:File) {
    if (!file || !replace) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("projectId",projectId); form.append("replaceId",replace); form.append("file",file);
      const response = await fetch("/api/documents",{method:"POST",body:form});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh(); onChanged(); onNotice(`已更新到 v${data.document.version}，旧版可在原文中查看。`);
    } catch (error) { setError(error instanceof Error ? error.message : "更新失败"); }
    finally { setBusy(false); setReplace(null); if(input.current) input.current.value=""; }
  }
  async function remove(id:string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/documents/${id}?projectId=${projectId}`,{method:"DELETE"});
      if (!response.ok) throw new Error("删除失败，请重试");
      onSelect(selected.filter(item => item !== id)); await refresh(); onChanged();
      setDeleting(null); onNotice("资料已移出知识库，后续问题不再检索它。历史问答仍可能保留当时的回答。");
    } catch (error) { setError(error instanceof Error ? error.message : "删除失败"); }
    finally {setBusy(false);}
  }
  const visibleDocuments = documents.filter(doc => doc.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (format === "all" || (format === "text" ? /\.(md|markdown|txt|csv|json|html?)$/i.test(doc.name) : doc.name.toLowerCase().endsWith(`.${format}`))));
  const Container = expanded ? "section" : "details";
  const heading = <>▤ 资料库 <span>{documents.length} 份 · 已保存到本机</span></>;
  return <Container className={`document-library ${expanded ? "library-expanded" : ""}`}>
    {expanded ? <h2 className="library-title">{heading}</h2> : <summary>{heading}</summary>}
    <div className="library-toolbar">
      <label className="library-search"><span aria-hidden="true">⌕</span><input aria-label="搜索资料名称" placeholder="搜索资料名称…" value={search} onChange={e=>setSearch(e.target.value)} /></label>
      <select aria-label="筛选文件类型" value={format} onChange={e=>setFormat(e.target.value)}><option value="all">全部类型</option><option value="text">文本 / Markdown</option><option value="pdf">PDF</option><option value="docx">Word</option></select>
      <span className="library-result-count">{visibleDocuments.length} 份资料</span>
    </div>
    <div className="library-selection-bar"><p className="document-note">{selected.length ? `已选 ${selected.length} 份，本次仅检索所选资料` : "勾选资料限定问答范围，最多 20 份；不勾选时检索全部资料。"}</p>
      {selected.length ? <button type="button" disabled={busy} onClick={()=>onSelect([])}>清除选择</button> : null}
      {onAsk ? <button type="button" className="library-ask" onClick={onAsk}>{selected.length ? "问这些资料" : "问全部资料"} ↗</button> : null}
    </div>
    {error ? <p role="alert">{error} <button type="button" onClick={() => void refresh().catch(e => setError(e.message))}>重试</button></p> : null}
    {!documents.length ? <p className="library-empty">还没有资料。点击“上传文件”，从一份项目文档开始。</p> : !visibleDocuments.length ? <p className="library-empty">没有匹配的资料，试试其他名称或文件类型。</p> : visibleDocuments.map(doc => <article className={`document-row ${selected.includes(doc.id) ? "is-selected" : ""}`} key={doc.id}>
      <label><input type="checkbox" checked={selected.includes(doc.id)} disabled={busy || (!selected.includes(doc.id) && selected.length >= 20)}
        onChange={e => onSelect(e.target.checked ? [...selected,doc.id].slice(0,20) : selected.filter(id => id !== doc.id))} />
        <span className="file-type-icon" aria-hidden="true">{doc.name.split(".").at(-1)?.toUpperCase().slice(0,4)}</span>
        <span className="document-name"><strong>{doc.name}</strong><small>入库版本 v{doc.version} · {doc.characters.toLocaleString()} 字符{doc.truncated ? " · 部分解析" : ""}</small></span></label>
      <span className="document-state">可问答</span>
      <div className="document-row-actions">
        <button type="button" onClick={() => onPreview({id:doc.id})}>查看原文</button>
        <button type="button" disabled={busy} onClick={() => {setReplace(doc.id); input.current?.click();}}>上传新版</button>
        <button type="button" disabled={busy} onClick={() => setDeleting(doc.id)}>删除</button>
      </div>
      {deleting === doc.id ? <div className="document-delete-confirm">
        <span>移出后停止检索，历史版本仍保留在本机，暂不支持界面恢复。</span>
        <button type="button" disabled={busy} onClick={() => void remove(doc.id)}>确认移出</button>
        <button type="button" onClick={() => setDeleting(null)}>取消</button>
      </div> : null}
    </article>)}
    <input className="visually-hidden" type="file" ref={input} aria-label="选择文档新版本"
      accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm" onChange={e => void update(e.target.files?.[0])} />
    {busy ? <p role="status">正在处理，完成后生效…</p> : null}
  </Container>;
}
