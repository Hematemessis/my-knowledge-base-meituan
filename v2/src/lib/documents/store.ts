import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DocumentChunk, DocumentSummary, DocumentVersion, Evidence } from "./types";

// A transactional, on-disk store for the local single-user application.
// All versions and their chunks commit together; retrieval reads only live heads.
export class DocumentStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS document_versions (
        document TEXT NOT NULL REFERENCES documents(id), version INTEGER NOT NULL,
        name TEXT NOT NULL, size INTEGER NOT NULL, updated TEXT NOT NULL,
        text TEXT NOT NULL, truncated INTEGER NOT NULL, digest TEXT NOT NULL, original BLOB NOT NULL,
        PRIMARY KEY(document, version));
      CREATE INDEX IF NOT EXISTS documents_project ON documents(project, deleted);
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, version INTEGER NOT NULL,
        ordinal INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL,
        FOREIGN KEY(document, version) REFERENCES document_versions(document, version));`);
  }
  close() { this.db.close(); }

  list(projectId: string): DocumentSummary[] {
    return this.db.prepare(`SELECT d.id, d.project AS projectId, v.name, v.version, v.size,
      v.updated AS updatedAt, length(v.text) AS characters, v.truncated FROM documents d
      JOIN document_versions v ON v.document=d.id AND v.version=d.version
      WHERE d.project=? AND d.deleted=0 ORDER BY v.updated DESC`).all(projectId)
      .map(row => ({ ...row, truncated: Boolean(row.truncated) })) as unknown as DocumentSummary[];
  }

  get(projectId: string, id: string, version?: number): DocumentVersion | null {
    const head = this.list(projectId).find(item => item.id === id);
    if (!head) return null;
    const row = this.db.prepare(`SELECT name, version, size, updated AS updatedAt,
      length(text) AS characters, truncated FROM document_versions WHERE document=? AND version=?`)
      .get(id, version ?? head.version);
    if (!row) return null;
    const chunks = this.db.prepare(`SELECT id, ordinal, start, end, text FROM document_chunks
      WHERE document=? AND version=? ORDER BY ordinal`).all(id, version ?? head.version);
    const versions = this.db.prepare(`SELECT version, name, updated AS updatedAt FROM document_versions
      WHERE document=? ORDER BY version DESC`).all(id);
    return { ...head, ...row, truncated: Boolean(row.truncated), chunks, versions } as unknown as DocumentVersion;
  }

  save(input: { projectId: string; name: string; text: string; original: Uint8Array;
    truncated: boolean; replaceId?: string }): DocumentVersion {
    const id = input.replaceId ?? randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const head = input.replaceId ? this.get(input.projectId, id) : null;
      if (input.replaceId && !head) throw new Error("找不到要更新的文档");
      const version = (head?.version ?? 0) + 1;
      if (!head) this.db.prepare("INSERT INTO documents(id,project,version) VALUES(?,?,?)").run(id,input.projectId,version);
      this.db.prepare(`INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?,?)`).run(
        id, version, input.name, input.original.length, new Date().toISOString(), input.text,
        Number(input.truncated), createHash("sha256").update(input.original).digest("hex"), input.original);
      const insert = this.db.prepare("INSERT INTO document_chunks VALUES(?,?,?,?,?,?,?)");
      for (const chunk of chunkText(input.text)) {
        insert.run(chunk.id, id, version, chunk.ordinal, chunk.start, chunk.end, chunk.text);
      }
      this.db.prepare("UPDATE documents SET version=? WHERE id=?").run(version,id);
      this.db.exec("COMMIT");
      return this.get(input.projectId, id)!;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  remove(projectId: string, id: string): boolean {
    return this.db.prepare("UPDATE documents SET deleted=1 WHERE id=? AND project=? AND deleted=0")
      .run(id, projectId).changes > 0;
  }

  original(projectId: string, id: string, version: number): Uint8Array | null {
    if (!this.get(projectId, id, version)) return null;
    return this.db.prepare("SELECT original FROM document_versions WHERE document=? AND version=?")
      .get(id, version)?.original as Uint8Array;
  }

  retrieve(projectId: string, query: string, ids: string[] = []): Evidence[] {
    const terms = tokenize(query);
    const all = this.list(projectId).filter(doc => !ids.length || ids.includes(doc.id));
    const ranked = all.flatMap(doc => this.get(projectId, doc.id)!.chunks.map(chunk => {
      const tokens = tokenize(doc.name + " " + chunk.text);
      const score = [...terms].filter(term => tokens.has(term)).length / Math.max(1, terms.size);
      return { ...chunk, documentId: doc.id, name: doc.name, version: doc.version, updatedAt: doc.updatedAt, score };
    })).filter(item => item.score >= 0.04 || ids.length > 0)
      .sort((a,b) => b.score-a.score || a.ordinal-b.ordinal);
    // Reserve one chunk per document before filling the remaining budget.
    const chosen: typeof ranked = [];
    for (const item of ranked) {
      if (!chosen.some(other => other.documentId === item.documentId) && chosen.length < 8) chosen.push(item);
    }
    for (const item of ranked) {
      if (chosen.length >= 12) break;
      if (!chosen.some(other => other.id === item.id)) chosen.push(item);
    }
    return chosen.map(({ score: _score, ...item }, index) => ({ ...item, citation: index + 1 }));
  }

  isCurrent(projectId: string, sources: Evidence[]): boolean {
    const heads = this.list(projectId);
    return sources.every(source => heads.some(head => head.id === source.documentId && head.version === source.version));
  }
}

export function chunkText(text: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1200, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + 400) end = newline + 1;
    }
    chunks.push({ id: randomUUID(), ordinal: chunks.length + 1, start, end, text: text.slice(start,end) });
    start = end;
  }
  return chunks;
}

function tokenize(value: string) {
  const tokens = new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []);
  for (const run of value.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let i=0; i<run.length-1; i++) tokens.add(run.slice(i,i+2));
  }
  return tokens;
}

const globalStore = globalThis as typeof globalThis & { knowledgeDocumentStore?: DocumentStore };
export function getDocumentStore() {
  return globalStore.knowledgeDocumentStore ??= new DocumentStore(
    resolve(process.env.KNOWLEDGE_DATA_DIR || ".data", "documents.sqlite"));
}
