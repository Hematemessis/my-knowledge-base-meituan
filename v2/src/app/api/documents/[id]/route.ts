import { z } from "zod";
import { getDocumentStore } from "@/lib/documents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request:Request, context:Context) {
  const {id} = await context.params;
  const url = new URL(request.url);
  const project = url.searchParams.get("projectId");
  const version = url.searchParams.get("version");
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(project).success ||
      (version !== null && !/^[1-9]\d*$/.test(version))) return Response.json({error:"参数无效"},{status:400});
  const store = getDocumentStore();
  const document = store.get(project!, id, version ? Number(version) : undefined);
  if (!document) return Response.json({error:"文档已删除或不存在"},{status:404});
  if (url.searchParams.get("download") === "1") {
    const bytes = store.original(project!,id,document.version)!;
    return new Response(new Uint8Array(bytes), {headers:{
      "Content-Type":"application/octet-stream", "Cache-Control":"no-store",
      "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      "X-Content-Type-Options":"nosniff",
    }});
  }
  return Response.json({document},{headers:{"Cache-Control":"no-store"}});
}

export async function DELETE(request:Request, context:Context) {
  const {id} = await context.params;
  const project = new URL(request.url).searchParams.get("projectId");
  if (!z.uuid().safeParse(project).success || !z.uuid().safeParse(id).success) return Response.json({error:"参数无效"},{status:400});
  const removed = getDocumentStore().remove(project!,id);
  return Response.json(removed ? {removed:true} : {error:"文档不存在"},{status:removed ? 200 : 404});
}
