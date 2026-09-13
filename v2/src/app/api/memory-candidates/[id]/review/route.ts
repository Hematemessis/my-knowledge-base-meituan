import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import { reviewMemoryCandidate } from "@/lib/memory/service";
import { candidateReviewActions } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

const reviewSchema = z
  .object({
    action: z.enum(candidateReviewActions),
    targetMemoryId: z.uuid().nullable().optional(),
    reason: z.string().trim().max(500).optional(),
    patch: z
      .object({
        subject: z.string().trim().max(120).optional(),
        statement: z.string().trim().min(3).max(2_000).optional(),
        importance: z.number().int().min(0).max(100).optional(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.action === "merge" || value.action === "replace") &&
      !value.targetMemoryId
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryId"],
        message: "合并或替代必须选择已有记忆",
      });
    }
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: "候选记忆 ID 无效" }, { status: 400 });
    }
    const input = reviewSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const result = await reviewMemoryCandidate(repository, {
      candidateId: id,
      ...input,
    });
    return NextResponse.json({ storageMode: repository.storageMode, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "审核操作无效", issues: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "审核候选记忆失败";
    const status = message.includes("不存在") ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
