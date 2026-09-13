import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import { undoMemoryCandidateReview } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

const undoSchema = z.object({
  reason: z.string().trim().max(500).optional(),
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
    const input = undoSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const result = await undoMemoryCandidateReview(repository, id, input.reason);
    return NextResponse.json({ storageMode: repository.storageMode, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "撤销操作无效", issues: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "撤销审核失败";
    const status = message.includes("不存在") ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
