import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import { restoreMemoryVersion } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const { id, version } = await context.params;
    if (!z.uuid().safeParse(id).success || !/^\d+$/.test(version)) {
      return NextResponse.json({ error: "记忆或版本 ID 无效" }, { status: 400 });
    }
    const input = restoreSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const result = await restoreMemoryVersion(
      repository,
      id,
      Number(version),
      input.reason,
    );
    return NextResponse.json({ storageMode: repository.storageMode, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "恢复操作无效", issues: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "恢复历史版本失败";
    const status = message.includes("不存在") ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
