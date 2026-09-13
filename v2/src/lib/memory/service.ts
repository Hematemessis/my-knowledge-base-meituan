import type { MemoryRepository } from "./repository";
import { extractMemoryCandidatesWithModel } from "./model-extractor";
import type {
  CandidateReviewInput,
  CandidateReviewItem,
  ConfirmedMemoryInput,
  ContextBundle,
  ContextSelection,
  MemoryCandidateDraft,
  MemoryCandidateRecord,
  MemoryRecord,
  MemoryScope,
  MemoryType,
} from "./types";

const latinTokenPattern = /[a-z0-9][a-z0-9_-]+/g;
const chineseSequencePattern = /[\u3400-\u9fff]+/g;

function tokenize(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set(normalized.match(latinTokenPattern) ?? []);
  for (const sequence of normalized.match(chineseSequencePattern) ?? []) {
    if (sequence.length === 1) tokens.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }
  return tokens;
}

function lexicalScore(query: Set<string>, memory: MemoryRecord): number {
  if (query.size === 0) return 0;
  const candidate = tokenize(`${memory.subject} ${memory.statement}`);
  if (candidate.size === 0) return 0;
  let intersection = 0;
  for (const token of query) {
    if (candidate.has(token)) intersection += 1;
  }
  return intersection / Math.max(1, query.size);
}

function candidateSimilarity(
  candidate: MemoryCandidateRecord,
  memory: MemoryRecord,
): number {
  const candidateTokens = tokenize(`${candidate.subject} ${candidate.statement}`);
  const memoryTokens = tokenize(`${memory.subject} ${memory.statement}`);
  const union = new Set([...candidateTokens, ...memoryTokens]);
  let intersection = 0;
  for (const token of candidateTokens) {
    if (memoryTokens.has(token)) intersection += 1;
  }
  const lexical = union.size === 0 ? 0 : intersection / union.size;
  const genericSubjects = new Set([
    "工作方式",
    "目标",
    "用户偏好",
    "项目决策",
    "已知事实",
    "阶段记录",
  ]);
  const sameSubject =
    candidate.subject.length > 0 &&
    !genericSubjects.has(candidate.subject) &&
    candidate.subject === memory.subject;
  return Number(Math.max(lexical, sameSubject ? 0.72 : 0).toFixed(4));
}

const extractionRules: Array<{
  type: MemoryType;
  subject: string;
  importance: number;
  confidence: number;
  patterns: string[];
}> = [
  {
    type: "workflow",
    subject: "工作方式",
    importance: 78,
    confidence: 0.82,
    patterns: ["以后每次", "每次都", "默认先", "流程是", "习惯", "都要保留"],
  },
  {
    type: "goal",
    subject: "目标",
    importance: 82,
    confidence: 0.84,
    patterns: ["目标是", "目标为", "计划", "接下来要", "希望实现"],
  },
  {
    type: "preference",
    subject: "用户偏好",
    importance: 76,
    confidence: 0.82,
    patterns: ["我喜欢", "我偏好", "我希望", "更喜欢", "不喜欢", "我习惯"],
  },
  {
    type: "decision",
    subject: "项目决策",
    importance: 86,
    confidence: 0.88,
    patterns: [
      "决定",
      "确定",
      "采用",
      "选择",
      "优先",
      "必须",
      "暂时不",
      "先做",
      "不做",
      "保持",
      "不要",
      "改成",
      "改为",
      "不再",
    ],
  },
  {
    type: "fact",
    subject: "已知事实",
    importance: 66,
    confidence: 0.7,
    patterns: ["这是", "目前", "现在", "已经", "属于", "项目是"],
  },
  {
    type: "episode",
    subject: "阶段记录",
    importance: 45,
    confidence: 0.68,
    patterns: ["昨天", "今天完成", "本周", "上周", "刚刚完成"],
  },
];

function splitSourceText(sourceText: string): string[] {
  return sourceText
    .replace(/\r/g, "\n")
    .split(/[。！？!?；;\n]+/)
    .map((sentence) => sentence.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter((sentence) => sentence.length >= 4 && sentence.length <= 500);
}

export function extractMemoryCandidates(input: {
  sourceText: string;
  scope: MemoryScope;
}): MemoryCandidateDraft[] {
  const seen = new Set<string>();
  const candidates: MemoryCandidateDraft[] = [];
  for (const sentence of splitSourceText(input.sourceText)) {
    const rule = extractionRules.find((item) =>
      item.patterns.some((pattern) => sentence.includes(pattern)),
    );
    if (!rule) continue;
    const statement = `${sentence.replace(/[。！？!?；;]+$/, "")}。`;
    const dedupeKey = statement.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({
      scope: input.scope,
      type: rule.type,
      subject: rule.subject,
      statement,
      confidence: rule.confidence,
      importance: rule.importance,
    });
    if (candidates.length >= 12) break;
  }
  return candidates;
}

export async function captureCandidateMemories(
  repository: MemoryRepository,
  input: {
    projectId?: string | null;
    sourceText: string;
    scope: MemoryScope;
  },
) {
  const sourceText = input.sourceText.trim();
  const modelCandidates = await extractMemoryCandidatesWithModel({
    sourceText,
    scope: input.scope,
  });
  const extractionMode = modelCandidates ? "model" : "heuristic";
  const candidates =
    modelCandidates ?? extractMemoryCandidates({ sourceText, scope: input.scope });
  const result = await repository.captureMemoryCandidates({
    projectId: input.projectId ?? null,
    sourceText,
    candidates,
    extractor: extractionMode,
  });
  return { ...result, extractionMode };
}

export async function listCandidateReviews(
  repository: MemoryRepository,
  options: { projectId?: string | null } = {},
): Promise<CandidateReviewItem[]> {
  const [candidates, memories] = await Promise.all([
    repository.listMemoryCandidates({
      projectId: options.projectId,
      status: "pending",
    }),
    repository.listMemories({ projectId: options.projectId, status: "active" }),
  ]);

  return candidates.map((candidate) => {
    const possibleMatches = memories
      .filter(
        (memory) =>
          memory.scope === candidate.scope &&
          memory.type === candidate.type &&
          memory.projectId === candidate.projectId,
      )
      .map((memory) => {
        const similarity = candidateSimilarity(candidate, memory);
        const reasons: string[] = [];
        if (candidate.subject === memory.subject) reasons.push("主题相同");
        if (similarity >= 0.55) reasons.push("表述高度相似");
        else if (similarity >= 0.12) reasons.push("内容可能相关");
        return { memory, similarity, reasons };
      })
      .filter((match) => match.similarity >= 0.12)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 3);
    const hasReplacementCue = ["改成", "改为", "不再", "取消", "替代"].some(
      (cue) => candidate.statement.includes(cue),
    );
    const suggestedAction =
      possibleMatches.length === 0
        ? "accept"
        : hasReplacementCue
          ? "replace"
          : "merge";
    return { candidate, possibleMatches, suggestedAction };
  });
}

export async function reviewMemoryCandidate(
  repository: MemoryRepository,
  input: CandidateReviewInput,
) {
  return repository.reviewMemoryCandidate({
    ...input,
    targetMemoryId: input.targetMemoryId ?? null,
    reason: input.reason?.trim() ?? "",
    patch: input.patch
      ? {
          subject: input.patch.subject?.trim(),
          statement: input.patch.statement?.trim(),
          importance:
            input.patch.importance === undefined
              ? undefined
              : Math.min(100, Math.max(0, input.patch.importance)),
        }
      : undefined,
  });
}

export async function undoMemoryCandidateReview(
  repository: MemoryRepository,
  candidateId: string,
  reason?: string,
) {
  return repository.undoMemoryCandidateReview(candidateId, reason?.trim() ?? "");
}

export async function restoreMemoryVersion(
  repository: MemoryRepository,
  memoryId: string,
  version: number,
  reason?: string,
) {
  return repository.restoreMemoryVersion(
    memoryId,
    Math.max(1, Math.floor(version)),
    reason?.trim() ?? "",
  );
}

function recencyScore(memory: MemoryRecord): number {
  if (memory.type !== "episode") return 1;
  const ageInDays = Math.max(
    0,
    (Date.now() - new Date(memory.lastConfirmedAt).getTime()) / 86_400_000,
  );
  return Math.exp(-ageInDays / 45);
}

function estimateTokens(text: string): number {
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const otherCharacters = text.length - chineseCharacters;
  return Math.max(1, Math.ceil(chineseCharacters * 1.05 + otherCharacters / 4));
}

function scoreMemory(
  memory: MemoryRecord,
  queryTokens: Set<string>,
  projectId: string | null,
): ContextSelection {
  const relevance = lexicalScore(queryTokens, memory);
  const exactProject = Boolean(projectId && memory.projectId === projectId);
  const scope = exactProject ? 1 : memory.scope === "global" ? 0.72 : 0.35;
  const importance = memory.importance / 100;
  const recency = recencyScore(memory);
  const score =
    relevance * 0.55 + scope * 0.2 + importance * 0.15 + recency * 0.1;
  const reasons: string[] = [];
  if (memory.importance >= 90) reasons.push("已锁定的重要记忆");
  if (exactProject) reasons.push("属于当前项目");
  if (memory.scope === "global") reasons.push("全局上下文");
  if (relevance >= 0.35) reasons.push("与当前任务直接相关");
  if (relevance > 0 && relevance < 0.35) reasons.push("与当前任务部分相关");

  return {
    memory,
    score: Number(score.toFixed(4)),
    relevance: Number(relevance.toFixed(4)),
    estimatedTokens: estimateTokens(memory.statement),
    reasons,
  };
}

export async function captureConfirmedMemory(
  repository: MemoryRepository,
  input: ConfirmedMemoryInput,
) {
  return repository.captureConfirmedMemory({
    ...input,
    subject: input.subject?.trim() ?? "",
    statement: input.statement.trim(),
    importance: Math.min(100, Math.max(0, input.importance ?? 70)),
    confidence: Math.min(1, Math.max(0, input.confidence ?? 1)),
  });
}

export async function assembleContext(
  repository: MemoryRepository,
  input: {
    query: string;
    projectId?: string | null;
    tokenBudget?: number;
    maxMemories?: number;
  },
): Promise<ContextBundle> {
  const projectId = input.projectId ?? null;
  const tokenBudget = Math.min(4_000, Math.max(200, input.tokenBudget ?? 1_200));
  const maxMemories = Math.min(20, Math.max(1, input.maxMemories ?? 8));
  const memories = await repository.listMemories({
    projectId,
    status: "active",
  });
  const queryTokens = tokenize(input.query);
  const ranked = memories
    .filter(
      (memory) =>
        !memory.validUntil || new Date(memory.validUntil).getTime() > Date.now(),
    )
    .map((memory) => scoreMemory(memory, queryTokens, projectId))
    .filter(
      (selection) =>
        selection.memory.importance >= 90 || selection.relevance >= 0.08,
    )
    .sort((left, right) => right.score - left.score);

  const selected: ContextSelection[] = [];
  let usedTokens = 0;
  for (const selection of ranked) {
    if (selected.length >= maxMemories) break;
    if (usedTokens + selection.estimatedTokens > tokenBudget) continue;
    selected.push(selection);
    usedTokens += selection.estimatedTokens;
  }

  const globalContext = selected.filter(
    (selection) =>
      selection.memory.scope === "global" && selection.memory.importance >= 90,
  );
  const projectContext = selected.filter(
    (selection) =>
      selection.memory.projectId === projectId && selection.memory.importance >= 85,
  );
  const fixedIds = new Set(
    [...globalContext, ...projectContext].map((selection) => selection.memory.id),
  );
  const relevantMemories = selected.filter(
    (selection) => !fixedIds.has(selection.memory.id),
  );

  const bundle: ContextBundle = {
    id: crypto.randomUUID(),
    storageMode: repository.storageMode,
    projectId,
    query: input.query.trim(),
    tokenBudget,
    estimatedTokens: usedTokens,
    generatedAt: new Date().toISOString(),
    globalContext,
    projectContext,
    relevantMemories,
  };
  await repository.saveContextSnapshot(bundle);
  return bundle;
}

export const memoryInternals = {
  candidateSimilarity,
  estimateTokens,
  splitSourceText,
  tokenize,
};
