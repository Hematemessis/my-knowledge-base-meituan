import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import { assembleContext } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

const assembleSchema = z.object({
  projectId: z.uuid().nullable().optional(),
  query: z.string().trim().min(1).max(4_000),
  tokenBudget: z.number().int().min(200).max(4_000).optional(),
  maxMemories: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const input = assembleSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const context = await assembleContext(repository, input);
    return NextResponse.json({ context });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "上下文请求无效", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to assemble context", error);
    return NextResponse.json({ error: "组装上下文失败" }, { status: 500 });
  }
}
