import { NextResponse } from "next/server";

import {
  extractFileText,
  isSupportedFile,
  MAX_UPLOAD_BYTES,
} from "@/lib/files/extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择要上传的文件" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "文件不能超过 10 MB" }, { status: 413 });
    }
    if (!isSupportedFile(file)) {
      return NextResponse.json(
        { error: "目前支持 PDF、DOCX、TXT、Markdown、CSV、JSON 和 HTML" },
        { status: 415 },
      );
    }

    const extracted = await extractFileText(file);
    if (!extracted.text) {
      return NextResponse.json(
        { error: "没有从文件中读取到可用文字" },
        { status: 422 },
      );
    }

    return NextResponse.json({
      file: { name: file.name, size: file.size, type: file.type },
      ...extracted,
    });
  } catch (error) {
    console.error("Failed to extract uploaded file", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "解析文件失败" },
      { status: 500 },
    );
  }
}
