import { z } from "zod";
import { getConversationStore } from "@/lib/conversations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const input = z.object({ id: z.uuid(), projectId: z.uuid() }).safeParse({
    ...(await params), projectId: new URL(request.url).searchParams.get("projectId"),
  });
  if (!input.success) return Response.json({ error: "对话地址无效" }, { status: 400 });
  try {
    const conversation = getConversationStore().get(input.data.projectId, input.data.id);
    return conversation ? Response.json({ conversation }) : Response.json({ error: "找不到这段对话" }, { status: 404 });
  } catch {
    return Response.json({ error: "对话读取失败，请稍后重试" }, { status: 500 });
  }
}
