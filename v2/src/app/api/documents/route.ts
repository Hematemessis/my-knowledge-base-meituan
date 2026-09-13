import { z } from "zod";
import { getDocumentStore } from "@/lib/documents/store";
import { extractFileText, isSupportedFile, MAX_UPLOAD_BYTES } from "@/lib/files/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get("projectId");
  if (!z.uuid().safeParse(project).success) return Response.json({ error: "请选择项目" },{status:400});
  return Response.json({ documents: getDocumentStore().list(project!) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const input = z.object({ projectId:z.uuid(), replaceId:z.uuid().optional() }).parse({
      projectId:form.get("projectId"), replaceId:form.get("replaceId") || undefined,
    });
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({error:"请选择文件"},{status:400});
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({error:"文件超过 10 MB，请拆分后上传"},{status:413});
    if (!isSupportedFile(file)) return Response.json({error:"暂不支持此格式，请使用 PDF、DOCX 或文本"},{status:415});
    const extracted = await extractFileText(file);
    if (!extracted.text.trim()) return Response.json({error:"未找到文字；空白文件或扫描件暂无法入库，请上传有文字层的文件"},{status:422});
    const document = getDocumentStore().save({ ...input, name:file.name.slice(0,255),
      text:extracted.text, truncated:extracted.truncated, original:new Uint8Array(await file.arrayBuffer()) });
    return Response.json({document},{status:201});
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({error:"文档参数无效"},{status:400});
    const password = error instanceof Error && /password|encrypt/i.test(error.message);
    return Response.json({error:password ? "文件已加密，请解密后重新上传" : "文件解析或保存失败，请检查文件是否损坏后重试"},{status:422});
  }
}
