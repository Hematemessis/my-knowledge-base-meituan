import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";
import { classifyMemoryType } from "@/lib/memory/classifier";
import { captureConfirmedMemory } from "@/lib/memory/service";
import { memoryScopes, memoryTypes } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

const createMemorySchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    scope: z.enum(memoryScopes),
    type: z.enum(memoryTypes).optional(),
    subject: z.string().trim().max(120).optional(),
    statement: z.string().trim().min(3).max(2_000),
    importance: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === "project" && !value.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "项目记忆必须指定 projectId",
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
  const memories = await repository.listMemories({ projectId });
  return NextResponse.json({
    storageMode: repository.storageMode,
    memories,
  });
}

export async function POST(request: Request) {
  try {
    const input = createMemorySchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const classification = input.type
      ? { type: input.type, mode: "manual" as const }
      : await classifyMemoryType(input.statement);
    const result = await captureConfirmedMemory(repository, {
      ...input,
      type: classification.type,
    });
    return NextResponse.json(
      { storageMode: repository.storageMode, classification, ...result },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "记忆内容无效", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to create confirmed memory", error);
    return NextResponse.json({ error: "保存记忆失败" }, { status: 500 });
  }
}
