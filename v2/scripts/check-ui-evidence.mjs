// Read-only checks of data created through the browser in the isolated UI test instance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.argv[2] || "http://127.0.0.1:3318";
assert.equal(new URL(base).hostname, "127.0.0.1");
const project = "00000000-0000-4000-8000-000000000001";
const sources = {
  "m2-示例资料.txt": "test-fixtures/m2-示例资料.txt",
  "m2-示例资料-v2.txt": "test-fixtures/m2-示例资料-v2.txt",
  "01-valid.pdf": "node_modules/.pnpm/pdf-parse@1.1.1/node_modules/pdf-parse/test/data/01-valid.pdf",
  "underline.docx": "node_modules/.pnpm/mammoth@1.10.0/node_modules/mammoth/test/test-data/underline.docx",
};
async function get(path) {
  const response = await fetch(base + path);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}
const { documents } = await get(`/api/documents?projectId=${project}`);
let originals = 0;
for (const summary of documents) {
  assert(sources[summary.name], "Run this only against the isolated fixture data");
  const { document } = await get(`/api/documents/${summary.id}?projectId=${project}`);
  for (const version of document.versions) {
    const download = await fetch(`${base}/api/documents/${summary.id}?projectId=${project}&version=${version.version}&download=1`);
    assert(download.ok);
    const hash = bytes => createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash(new Uint8Array(await download.arrayBuffer())), hash(await readFile(sources[version.name])));
    originals++;
  }
}
const { conversations } = await get(`/api/conversations?projectId=${project}`);
let messages = 0, citations = 0;
for (const summary of conversations) {
  const { conversation } = await get(`/api/conversations/${summary.id}?projectId=${project}`);
  assert.equal(conversation.pending, null);
  messages += conversation.messages.length;
  for (const message of conversation.messages) {
    for (const source of message.citations || []) {
      const { document } = await get(`/api/documents/${source.documentId}?projectId=${project}&version=${source.version}`);
      const chunk = document.chunks.find(chunk => chunk.id === source.id);
      assert(chunk); assert.equal(chunk.text, source.text); assert.equal(chunk.start, source.start); assert.equal(chunk.end, source.end);
      citations++;
    }
  }
}
const memory = await get(`/api/memories?projectId=${project}`);
assert.equal(memory.storageMode, "sqlite");
assert(memory.memories.some(item => item.statement === "仅用于实机验收：回答先给结论，再给依据。"));
assert(!memory.memories.some(item => item.statement === "这是实机验收的虚构偏好，请提取为待确认记忆。"));
console.log(JSON.stringify({ documents: documents.length, originalVersionsByteIdentical: originals,
  conversations: conversations.length, messages, citationsVerified: citations,
  confirmedMemories: memory.memories.length, correctedMemoryPresent: true, rejectedCandidateExcluded: true }, null, 2));
