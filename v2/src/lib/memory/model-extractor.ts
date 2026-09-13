import { z } from "zod";

import { memoryTypes, type MemoryCandidateDraft, type MemoryScope } from "./types";

export type CandidateExtractionMode = "heuristic" | "model";

const modelCandidateSchema = z.object({
  type: z.enum(memoryTypes),
  subject: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(3).max(2_000),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(100),
});

const modelResultSchema = z.object({
  candidates: z.array(modelCandidateSchema).max(12),
});

function readTextContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as {
    output_text?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return null;
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

export async function extractMemoryCandidatesWithModel(input: {
  sourceText: string;
  scope: MemoryScope;
}): Promise<MemoryCandidateDraft[] | null> {
  if (process.env.MEMORY_EXTRACTION_ENABLED !== "true") return null;

  const endpoint = process.env.MEMORY_EXTRACTOR_URL?.trim();
  const model = process.env.MEMORY_EXTRACTOR_MODEL?.trim();
  if (!endpoint || !model) {
    console.warn(
      "Model memory extraction is enabled, but MEMORY_EXTRACTOR_URL or MEMORY_EXTRACTOR_MODEL is missing. Falling back to local rules.",
    );
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.MEMORY_EXTRACTOR_API_KEY
          ? { authorization: `Bearer ${process.env.MEMORY_EXTRACTOR_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract only durable user facts, preferences, decisions, goals, workflows, and meaningful project episodes. Ignore small talk and transient requests. Return JSON with a candidates array. Each candidate needs type, subject, statement, confidence from 0 to 1, and importance from 0 to 100. Preserve the source language.",
          },
          {
            role: "user",
            content: input.sourceText,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`memory extractor returned HTTP ${response.status}`);
    }
    const content = readTextContent(await response.json());
    if (!content) throw new Error("memory extractor returned no text content");
    const parsed = modelResultSchema.parse(parseJsonObject(content));
    return parsed.candidates.map((candidate) => ({
      ...candidate,
      scope: input.scope,
      importance: Math.round(candidate.importance),
    }));
  } catch (error) {
    console.warn(
      "Model memory extraction failed. Falling back to local rules.",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
