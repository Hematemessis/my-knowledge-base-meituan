import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 100_000;

export type ExtractedFile = {
  text: string;
  truncated: boolean;
  pageCount?: number;
};

const plainTextExtensions = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "html",
  "htm",
]);

function extensionOf(filename: string): string {
  return filename.toLowerCase().split(".").pop() || "";
}

function cleanExtractedText(value: string): ExtractedFile {
  const normalized = value
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  const truncated = normalized.length > MAX_EXTRACTED_CHARACTERS;
  return {
    text: normalized.slice(0, MAX_EXTRACTED_CHARACTERS),
    truncated,
  };
}

export function isSupportedFile(file: Pick<File, "name" | "type">): boolean {
  const extension = extensionOf(file.name);
  return (
    plainTextExtensions.has(extension) ||
    extension === "docx" ||
    extension === "pdf" ||
    file.type.startsWith("text/") ||
    file.type === "application/json"
  );
}

export async function extractFileText(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("文件不能超过 10 MB");
  }
  if (!isSupportedFile(file)) {
    throw new Error("目前支持 PDF、DOCX、TXT、Markdown、CSV、JSON 和 HTML");
  }

  const extension = extensionOf(file.name);
  if (extension === "docx") {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    return cleanExtractedText(result.value);
  }

  if (extension === "pdf") {
    // The package entrypoint contains a debug-only file read that can be
    // misdetected after server bundling. Import the actual parser directly.
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = pdfParseModule.default;
    const result = await pdfParse(Buffer.from(await file.arrayBuffer()));
    return { ...cleanExtractedText(result.text), pageCount: result.numpages };
  }

  return cleanExtractedText(await file.text());
}

export const fileExtractionInternals = { cleanExtractedText, extensionOf };
