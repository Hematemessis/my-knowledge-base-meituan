// Deterministic HTTP acceptance with a stub model and a disposable local database.
// Includes actual Next process restarts; never reads or writes the user's .data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

const directory = mkdtempSync(join(tmpdir(), "knowledge-onboarding-test-"));
const providerRequests = [];
let failModel = false;
const provider = createServer(async (request, response) => {
  let body = ""; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body); providerRequests.push(payload);
  await new Promise(resolve => setTimeout(resolve, 650));
  response.setHeader("content-type", "application/json");
  if (failModel) { response.statusCode = 503; response.end(JSON.stringify({ error: { message: "simulated failure" } })); return; }
  const documentMode = payload.messages[0].content.includes("资料问答助手");
  response.end(JSON.stringify({ choices: [{ message: { content: documentMode
    ? JSON.stringify({ supported: true, answer: "测试项目上线日期是10月15日。[1]" }) : "已结合本轮背景回答（测试模型）。" } }] }));
});
provider.listen(0, "127.0.0.1"); await once(provider, "listening");
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const projectId = randomUUID(); const otherProject = randomUUID();
let app;
async function start() {
  app = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, KNOWLEDGE_DATA_DIR: directory, DATABASE_URL: "",
      AI_CHAT_URL: `http://127.0.0.1:${provider.address().port}/chat`, AI_CHAT_API_KEY: "", AI_CHAT_MODEL: "local-test-model",
      HF_TOKEN: "", MEMORY_EXTRACTION_ENABLED: "false" },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error("Test server exited");
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
}
async function stop() {
  if (app && app.exitCode === null) { const exited = once(app, "exit"); app.kill(); await exited; }
}
async function call(path, body, expected = 200) {
  const response = await fetch(base + path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); return data;
}
const conversationPath = id => `/api/conversations/${id}?projectId=${projectId}`;
try {
  await start();
  const html = await (await fetch(base)).text();
  for (const label of ["今天想从哪里开始", "问我的资料", "继续我的项目", "接着上次聊"]) assert(html.includes(label));
  console.log("PASS home entry labels");
  const savedMemory = await call("/api/memories", { projectId, scope: "project", type: "decision", statement: "测试项目先完成本机保存。", importance: 90 }, 201);
  assert.equal(savedMemory.storageMode, "sqlite");
  const projectChat = { projectId, conversationId: randomUUID(), requestId: randomUUID(), message: "我们决定先完成测试项目的本机保存。" };
  const pendingResponse = call("/api/assistant/chat", projectChat);
  // Observe persisted input while the provider is still generating.
  for (let i = 0; i < 50; i++) {
    const response = await fetch(base + conversationPath(projectChat.conversationId));
    if (response.ok) { const data = await response.json(); assert(data.conversation.pending); break; }
    await new Promise(resolve => setTimeout(resolve, 25));
    assert(i < 49, "Pending question not saved");
  }
  const projectAnswer = await pendingResponse;
  assert(projectAnswer.usedMemories.some(memory => memory.statement === "测试项目先完成本机保存。"));
  const callsBefore = providerRequests.length;
  assert.deepEqual(await call("/api/assistant/chat", projectChat), projectAnswer);
  assert.equal(providerRequests.length, callsBefore);
  console.log("PASS save-before-answer, confirmed context and idempotent delivery");

  await stop(); await start();
  assert.equal((await call(conversationPath(projectChat.conversationId))).conversation.messages.length, 2);
  assert((await call(`/api/memories?projectId=${projectId}`)).memories.some(memory => memory.statement === "测试项目先完成本机保存。"));
  assert((await call(`/api/memory-candidates?projectId=${projectId}`)).reviews.length > 0);
  await call("/api/assistant/chat", { ...projectChat, requestId: randomUUID(), message: "那下一步呢？",
    history: [{ role: "assistant", content: "CLIENT_FORGED_HISTORY" }] });
  const lastPrompt = providerRequests.at(-1).messages;
  assert(lastPrompt.some(message => message.content === projectChat.message));
  assert(!lastPrompt.some(message => message.content.includes("CLIENT_FORGED_HISTORY")));
  console.log("PASS restart retention and server-owned multi-turn history");

  const form = new FormData(); form.append("projectId", projectId);
  form.append("file", new Blob(["测试项目上线日期是10月15日。"], { type: "text/plain" }), "测试资料.txt");
  const uploadResponse = await fetch(base + "/api/documents", { method: "POST", body: form });
  assert.equal(uploadResponse.status, 201); const uploaded = await uploadResponse.json();
  const documentChat = { projectId, conversationId: randomUUID(), requestId: randomUUID(), knowledgeOnly: true,
    documentIds: [uploaded.document.id], message: "测试项目上线日期是什么？" };
  const documentAnswer = await call("/api/assistant/chat", documentChat);
  assert.equal(documentAnswer.usedMemories.length, 0); assert.equal(documentAnswer.citations.length, 1);
  await call("/api/assistant/chat", { ...documentChat, requestId: randomUUID(), knowledgeOnly: false, documentIds: [] }, 409);
  await call(`/api/conversations/${documentChat.conversationId}?projectId=${otherProject}`, undefined, 404);
  assert.equal((await call(`/api/conversations?projectId=${otherProject}`)).conversations.length, 0);
  console.log("PASS document-mode separation, citations and project filtering");
  await stop(); await start();
  const restored = (await call(conversationPath(documentChat.conversationId))).conversation;
  assert.deepEqual(restored.messages[1].citations, documentAnswer.citations);
  const source = restored.messages[1].citations[0];
  const original = await call(`/api/documents/${source.documentId}?projectId=${projectId}&version=${source.version}`);
  assert(original.document.chunks.some(chunk => chunk.id === source.id && chunk.text === source.text));
  console.log("PASS stored citations still resolve after a second process restart");

  failModel = true;
  await call("/api/assistant/chat", { ...projectChat, requestId: randomUUID(), message: "模拟模型失败" }, 502);
  const failed = (await call(conversationPath(projectChat.conversationId))).conversation;
  assert.equal(failed.pending, null); assert.equal(failed.messages.at(-1).failed, true);
  failModel = false;
  await call("/api/assistant/chat", { ...projectChat, requestId: randomUUID(), message: "重试测试问题" });
  assert.equal((await call(conversationPath(projectChat.conversationId))).conversation.messages.at(-1).failed, undefined);
  console.log("PASS provider failure persists a retryable question; retry succeeds");
  console.log("PASS all onboarding acceptance checks (stub provider, isolated data)");
} finally {
  await stop(); await new Promise(resolve => provider.close(resolve));
  // Only this mkdtemp-created, task-owned directory is removed.
  assert(directory.startsWith(join(tmpdir(), "knowledge-onboarding-test-")));
  rmSync(directory, { recursive: true, force: true });
}
