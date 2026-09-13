import { NextResponse } from "next/server";
import { z } from "zod";

import { answerWithAssistantProvider, answerWithDocumentEvidence } from "@/lib/assistant/provider";
import { getDocumentStore } from "@/lib/documents/store";
import { evidencePrompt, NO_EVIDENCE, validateEvidenceAnswer } from "@/lib/documents/answer";
import type { Evidence } from "@/lib/documents/types";
import { getMemoryRepository } from "@/lib/memory/factory";
import { assembleContext, captureCandidateMemories } from "@/lib/memory/service";
import type { ContextBundle, ContextSelection } from "@/lib/memory/types";
import { ConversationError, getConversationStore } from "@/lib/conversations/store";
import type { ChatAnswer } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chatSchema = z.object({
  conversationId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  uploadedFiles: z.array(z.object({ name: z.string().min(1).max(255), size: z.number().nonnegative() })).max(5).default([]),
  projectId: z.uuid().nullable().optional(),
  documentIds: z.array(z.uuid()).max(20).default([]),
  knowledgeOnly: z.boolean().default(false),
  message: z.string().trim().min(1).max(20_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8_000),
      }),
    )
    .max(12)
    .default([]),
  attachments: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        text: z.string().max(30_000),
      }),
    )
    .max(5)
    .default([]),
});

function flattenContext(context: {
  globalContext: ContextSelection[];
  projectContext: ContextSelection[];
  relevantMemories: ContextSelection[];
}) {
  return [
    ...context.globalContext,
    ...context.projectContext,
    ...context.relevantMemories,
  ];
}

function formatMemoryContext(selections: ContextSelection[]): string {
  if (selections.length === 0) return "这次没有检索到相关的已确认记忆。";
  return [
    "以下是这次检索到的已确认记忆：",
    ...selections.map(
      (selection, index) =>
        `${index + 1}. [${selection.memory.type}/${selection.memory.scope}] ${selection.memory.statement}`,
    ),
  ].join("\n");
}

function formatAttachmentContext(attachments: Array<{ name: string; text: string }>) {
  if (attachments.length === 0) return "";
  return [
    "以下是用户本轮上传的资料：",
    ...attachments.map(
      (attachment) => `--- ${attachment.name} ---\n${attachment.text}`,
    ),
  ]
    .join("\n\n")
    .slice(0, 40_000);
}

function localModeAnswer(input: {
  selections: ContextSelection[];
  attachments: Array<{ name: string; text: string }>;
}) {
  const memoryLines = input.selections
    .slice(0, 5)
    .map((selection) => `- ${selection.memory.statement}`);
  const fileLine = input.attachments.length
    ? `\n\n已成功读取 ${input.attachments.length} 个文件：${input.attachments.map((item) => item.name).join("、")}。`
    : "";
  return [
    "现在是本地模式：输入、文件解析和记忆检索都已正常工作，但还没有配置生成回答的 AI 模型。",
    input.selections.length
      ? `\n这次找到 ${input.selections.length} 条相关记忆：\n${memoryLines.join("\n")}`
      : "\n这次没有找到相关的已确认记忆。",
    fileLine,
    "\n配置 HF_TOKEN / HF_MODEL，或 AI_CHAT_URL / AI_CHAT_MODEL 后，这里就会直接生成完整回答。",
  ].join("");
}

export async function POST(request: Request) {
  let turn: { projectId: string; id: string; requestId: string } | null = null;
  try {
    const input = chatSchema.parse(await request.json());
    const documentMode = input.knowledgeOnly || input.documentIds.length > 0;
    if (input.conversationId) {
      if (!input.projectId || !input.requestId) return NextResponse.json({ error: "保存对话需要项目和请求编号" }, { status: 400 });
      const started = getConversationStore().begin({ id: input.conversationId, requestId: input.requestId,
        projectId: input.projectId, mode: documentMode ? "documents" : "project", message: input.message,
        documentIds: input.documentIds, attachments: input.uploadedFiles });
      if (started.cached) return NextResponse.json(started.cached);
      turn = { projectId: input.projectId, id: input.conversationId, requestId: input.requestId };
      // Once a conversation is persisted, client-supplied history is never authoritative.
      input.history = started.conversation.messages.slice(0, -1)
        .filter(item => !item.failed).slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 8000) }));
    }
    const repository = await getMemoryRepository();
    const retrievalQuery = [input.message, ...input.attachments.map((item) => item.name)]
      .join(" ")
      .slice(0, 4_000);
    const context: ContextBundle = documentMode ? {
      id:crypto.randomUUID(), storageMode:repository.storageMode, projectId:input.projectId ?? null,
      query:retrievalQuery, tokenBudget:1600, estimatedTokens:0, generatedAt:new Date().toISOString(),
      globalContext:[], projectContext:[], relevantMemories:[],
    } : await assembleContext(repository, {
      projectId: input.projectId,
      query: retrievalQuery,
      tokenBudget: 1_600,
      maxMemories: 8,
    });
    const selections = flattenContext(context);
    if (documentMode) await repository.saveContextSnapshot(context);
    if (documentMode && !input.projectId) throw new ConversationError("请指定资料所属项目", 400);
    const documents = getDocumentStore();
    if (input.documentIds.some(id => !documents.get(input.projectId!,id))) {
      throw new ConversationError("选择的资料已删除，请刷新资料列表后重试");
    }
    const followup = /它|那个|上次|另一|继续|比较|相比/.test(input.message);
    const sources = documentMode ? documents.retrieve(input.projectId!,
      [input.message, ...(followup ? input.history.filter(item => item.role === "user").slice(-2).map(item => item.content) : [])].join(" "),
      input.documentIds) : [];
    const providerAnswer = documentMode
      ? sources.length ? await answerWithDocumentEvidence({
        message:input.message, userHistory:input.history.filter(item => item.role === "user").map(item => item.content),
        evidence:evidencePrompt(sources),
      }) : null
      : await answerWithAssistantProvider({
      message: input.message,
      history: input.history,
      memoryContext: formatMemoryContext(selections),
      attachmentContext: formatAttachmentContext(input.attachments),
    });

    if (documentMode && !documents.isCurrent(input.projectId!,sources)) {
      throw new ConversationError("资料在回答期间已更新或删除，请重试以使用最新资料");
    }
    let citations: Evidence[] = [];
    let answer = providerAnswer?.text ?? localModeAnswer({ selections, attachments:input.attachments });
    if (documentMode) {
      const validated = providerAnswer ? validateEvidenceAnswer(providerAnswer.text,sources) : null;
      answer = validated?.text ?? (sources.length ? "AI 暂未配置，资料已保存。配置模型后可基于资料回答。" : NO_EVIDENCE);
      citations = validated?.citations ?? [];
    }

    // Document evidence is not a user fact; deleting a document must not leave
    // auto-extracted copies of its contents in personal memory.
    const captured = documentMode ? null : await captureCandidateMemories(repository, {
      projectId: input.projectId,
      scope: "project",
      sourceText: input.message.slice(0,10_000),
    });

    const result: ChatAnswer = {
      text: answer,
      citations,
      mode: providerAnswer ? "model" : "local",
      model: providerAnswer?.model ?? null,
      context,
      usedMemories: documentMode ? [] : selections.map((selection) => selection.memory),
      candidatesCreated: captured?.candidates.length ?? 0,
    };
    if (turn) getConversationStore().complete(turn.projectId, turn.id, turn.requestId, result);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof ConversationError ? error.message
      : "AI 服务暂时不可用或响应超时，请稍后重试。你的资料和已保存的问题仍然保留。";
    if (turn) {
      try { getConversationStore().fail(turn.projectId, turn.id, turn.requestId, message); }
      catch { console.error("Could not save conversation failure"); }
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "对话请求无效", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof ConversationError) return NextResponse.json({ error: message }, { status: error.status });
    console.error("Assistant request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
