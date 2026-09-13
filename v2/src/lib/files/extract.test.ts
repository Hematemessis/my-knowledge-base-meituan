import { describe, expect, it } from "vitest";

import { extractFileText, fileExtractionInternals, isSupportedFile } from "./extract";

describe("file extraction", () => {
  it("recognizes supported knowledge file formats", () => {
    expect(isSupportedFile({ name: "brief.pdf", type: "application/pdf" })).toBe(true);
    expect(
      isSupportedFile({
        name: "notes.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
    expect(isSupportedFile({ name: "archive.zip", type: "application/zip" })).toBe(false);
  });

  it("extracts and normalizes text files", async () => {
    const file = new File(["第一行  \r\n\r\n\r\n\r\n第二行\0"], "notes.md", {
      type: "text/markdown",
    });

    const result = await extractFileText(file);

    expect(result).toEqual({ text: "第一行\n\n\n第二行", truncated: false });
  });

  it("detects filename extensions without case sensitivity", () => {
    expect(fileExtractionInternals.extensionOf("Project.NOTES.MD")).toBe("md");
  });
});
