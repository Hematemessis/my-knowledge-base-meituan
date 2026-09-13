import { z } from "zod";
import { getConversationStore } from "@/lib/conversations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const project = z.uuid().safeParse(new URL(request.url).searchParams.get("projectId"));
  if (!project.success) return Response.json({ error: "请指定项目" }, { status: 400 });
  try {
    return Response.json({ conversations: getConversationStore().list(project.data) });
  } catch {
    return Response.json({ error: "历史对话读取失败，请稍后重试" }, { status: 500 });
  }
}
