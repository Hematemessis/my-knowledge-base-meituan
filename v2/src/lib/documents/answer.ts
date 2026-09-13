import type { Evidence } from "./types";

export const NO_EVIDENCE = "知识库暂无足够依据回答这个问题。请补充相关资料，或选择更具体的文档。";

export function evidencePrompt(sources: Evidence[]) {
  return JSON.stringify(sources.map(source => ({
    citation: `[${source.citation}]`, document:source.name, version:source.version,
    updatedAt:source.updatedAt, location:`解析片段 ${source.ordinal}`, text:source.text,
  })));
}

// Citation identifiers come only from server retrieval, never from model metadata.
export function validateEvidenceAnswer(raw: string, sources: Evidence[]) {
  try {
    const value = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as {
      supported?: boolean; answer?: string;
    };
    if (value.supported !== true || typeof value.answer !== "string") return {text:NO_EVIDENCE,citations:[]};
    const refs = [...value.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
    if (!refs.length || refs.some(ref => !sources.some(source => source.citation === ref))) {
      return {text:NO_EVIDENCE,citations:[]};
    }
    return {text:value.answer, citations:sources.filter(source => refs.includes(source.citation))};
  } catch { return {text:NO_EVIDENCE,citations:[]}; }
}
