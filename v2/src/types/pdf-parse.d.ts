declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = {
    numpages: number;
    text: string;
    info?: Record<string, unknown>;
  };

  export default function pdfParse(
    data: Buffer | Uint8Array,
  ): Promise<PdfParseResult>;
}
