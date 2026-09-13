import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import {
  captureCandidateMemories,
  listCandidateReviews,
} from "@/lib/memory/service";
import { memoryScopes } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

const captureSchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    sourceText: z.string().trim().min(4).max(10_000),
    scope: z.enum(memoryScopes).default("project"),
  })
  .superRefine((value, context) => {
    if (value.scope === "project" && !value.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "项目候选记忆必须指定 projectId",
      });
    }
  });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (projectId && !z.uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "projectId 格式无效" }, { status: 400 });
  }
  const repository = await getMemoryRepository();
  const [reviews, accepted, merged, rejected] = await Promise.all([
    listCandidateReviews(repository, { projectId }),
    repository.listMemoryCandidates({ projectId, status: "accepted" }),
    repository.listMemoryCandidates({ projectId, status: "merged" }),
    repository.listMemoryCandidates({ projectId, status: "rejected" }),
  ]);
  const latestReviewedCandidate = [...accepted, ...merged, ...rejected]
    .filter((candidate) => candidate.reviewAction && candidate.reviewedAt)
    .sort((left, right) =>
      (right.reviewedAt ?? "").localeCompare(left.reviewedAt ?? ""),
    )[0];
  return NextResponse.json({
    storageMode: repository.storageMode,
    reviews,
    lastReviewedCandidateId: latestReviewedCandidate?.id ?? null,
  });
}

export async function POST(request: Request) {
  try {
    const input = captureSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const result = await captureCandidateMemories(repository, input);
    return NextResponse.json(
      {
        storageMode: repository.storageMode,
        ...result,
        message:
          result.candidates.length > 0
            ? `已通过${result.extractionMode === "model" ? "模型" : "本地规则"}提取 ${result.candidates.length} 条候选记忆，等待确认。`
            : "没有发现足够明确的长期记忆，请补充决定、偏好或目标等表达。",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "输入内容无效", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to capture memory candidates", error);
    return NextResponse.json({ error: "提取候选记忆失败" }, { status: 500 });
  }
}
