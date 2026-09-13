import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";

export const dynamic = "force-dynamic";

const eventSchema = z.object({
  projectId: z.uuid().nullable().optional(),
  actor: z.enum(["user", "assistant", "agent", "system"]),
  kind: z.string().trim().min(2).max(80),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const input = eventSchema.parse(await request.json());
    const repository = await getMemoryRepository();
    const event = await repository.recordEvent(input);
    return NextResponse.json(
      { storageMode: repository.storageMode, event },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "事件内容无效", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to record event", error);
    return NextResponse.json({ error: "记录事件失败" }, { status: 500 });
  }
}
