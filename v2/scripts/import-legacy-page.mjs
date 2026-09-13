// Explicit one-time import of a locally captured, user-visible old page.
// Never reads browser internals or calls an AI provider. Keep the backup outside Git.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const backupPath = process.argv[2];
assert(backupPath, "Pass a local page backup JSON explicitly");
const raw = readFileSync(backupPath, "utf8");
const backup = JSON.parse(raw);
const projectId = "00000000-0000-4000-8000-000000000001";
const directory = resolve(process.env.KNOWLEDGE_DATA_DIR || ".data");
const docs = new DatabaseSync(resolve(directory, "documents.sqlite"), { readOnly: true });
const db = new DatabaseSync(resolve(directory, "context.sqlite"));
db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS legacy_page_imports (digest TEXT PRIMARY KEY, conversation TEXT NOT NULL)");
const digest = createHash("sha256").update(raw).digest("hex");
db.exec("BEGIN IMMEDIATE");
try {
  const existing = db.prepare("SELECT conversation FROM legacy_page_imports WHERE digest=?").get(digest);
  if (existing) console.log(JSON.stringify({ alreadyImported: true, conversationId: existing.conversation }));
  else {
    const documentRows = docs.prepare(`SELECT d.id, v.name, v.size FROM documents d JOIN document_versions v
      ON v.document=d.id AND v.version=d.version WHERE d.project=? AND d.deleted=0`).all(projectId);
    const byName = name => {
      const matches = documentRows.filter(row => row.name === name);
      assert.equal(matches.length, 1, "Legacy source must resolve uniquely"); return matches[0];
    };
    const timestamp = new Date().toISOString();
    const messages = backup.messages.map(item => ({ id: randomUUID(), role: item.role, content: item.content,
      ...(item.model ? { mode: "model", model: item.model } : {}),
      attachments: (item.fileNames || []).map(name => ({ name, size: byName(name).size })),
      citations: (item.sources || []).map(source => {
        const documentId = byName(source.name).id;
        const chunk = docs.prepare(`SELECT c.id,c.ordinal,c.start,c.end,c.text,v.updated AS updatedAt
          FROM document_chunks c JOIN document_versions v ON v.document=c.document AND v.version=c.version
          WHERE c.document=? AND c.version=? AND c.ordinal=?`).get(documentId, source.version, source.ordinal);
        assert(chunk?.text.startsWith(source.prefix), "Legacy citation must match the stored source");
        return { ...chunk, documentId, name: source.name, version: source.version, citation: source.citation };
      }),
    }));
    const id = randomUUID();
    const conversation = { id, projectId, mode: "documents", title: "升级前的对话 · " + messages[0].content,
      createdAt: timestamp, updatedAt: timestamp, documentIds: backup.documentNames.map(name => byName(name).id), messages, pending: null };
    db.prepare("INSERT INTO conversations VALUES (?,?,?,?)").run(id, projectId, timestamp, JSON.stringify(conversation));
    const state = JSON.parse(db.prepare("SELECT payload FROM memory_state WHERE id=1").get().payload);
    let restoredMemories = 0;
    for (const item of backup.memories) {
      if (state.memories.some(memory => memory.statement === item.statement && memory.status === "active")) continue;
      const eventId = randomUUID(); const memoryId = randomUUID();
      state.events.push({ id: eventId, projectId, actor: "user", kind: "memory.legacy_page_recovered",
        payload: { note: backup.note, statement: item.statement }, createdAt: timestamp });
      const memory = { id: memoryId, projectId, ...item, subject: "", status: "active", confidence: 1,
        sourceEventId: eventId, supersedesId: null, validFrom: timestamp, validUntil: null, lastConfirmedAt: timestamp,
        lastUsedAt: null, createdAt: timestamp, updatedAt: timestamp };
      state.memories.unshift(memory);
      state.versions.push([memoryId, [{ id: randomUUID(), memoryId, version: 1, statement: item.statement, subject: "",
        importance: item.importance, confidence: 1, changeReason: "从升级前页面恢复已确认记忆；原始时间不可恢复",
        sourceEventId: eventId, createdAt: timestamp }]]);
      restoredMemories++;
    }
    db.prepare("UPDATE memory_state SET payload=?,revision=revision+1 WHERE id=1").run(JSON.stringify(state));
    db.prepare("INSERT INTO legacy_page_imports VALUES (?,?)").run(digest, id);
    console.log(JSON.stringify({ conversationId: id, messages: messages.length,
      citations: messages.reduce((n, m) => n + m.citations.length, 0), restoredMemories }));
  }
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }
finally { db.close(); docs.close(); }
