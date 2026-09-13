import { NextResponse } from "next/server";
import { z } from "zod";

import { getMemoryRepository } from "@/lib/memory/factory";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "记忆 ID 无效" }, { status: 400 });
  }
  const repository = await getMemoryRepository();
  const versions = await repository.listMemoryVersions(id);
  return NextResponse.json({ storageMode: repository.storageMode, versions });
}
