import { afterEach, describe, expect, it, vi } from "vitest";

import { extractMemoryCandidatesWithModel } from "./model-extractor";

const originalEnvironment = {
  enabled: process.env.MEMORY_EXTRACTION_ENABLED,
  url: process.env.MEMORY_EXTRACTOR_URL,
  key: process.env.MEMORY_EXTRACTOR_API_KEY,
  model: process.env.MEMORY_EXTRACTOR_MODEL,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env.MEMORY_EXTRACTION_ENABLED = originalEnvironment.enabled;
  process.env.MEMORY_EXTRACTOR_URL = originalEnvironment.url;
  process.env.MEMORY_EXTRACTOR_API_KEY = originalEnvironment.key;
  process.env.MEMORY_EXTRACTOR_MODEL = originalEnvironment.model;
});

describe("optional model memory extractor", () => {
  it("does not call an external service unless explicitly enabled", async () => {
    delete process.env.MEMORY_EXTRACTION_ENABLED;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMemoryCandidatesWithModel({
      scope: "project",
      sourceText: "我们决定保留版本历史。",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a valid provider response into the requested scope", async () => {
    process.env.MEMORY_EXTRACTION_ENABLED = "true";
    process.env.MEMORY_EXTRACTOR_URL = "https://provider.test/v1/chat/completions";
    process.env.MEMORY_EXTRACTOR_MODEL = "test-model";
    process.env.MEMORY_EXTRACTOR_API_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      type: "decision",
                      subject: "版本策略",
                      statement: "重要决策必须保留版本。",
                      confidence: 0.94,
                      importance: 96.4,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMemoryCandidatesWithModel({
      scope: "global",
      sourceText: "以后所有项目的重要决策必须保留版本。",
    });

    expect(result).toEqual([
      expect.objectContaining({
        scope: "global",
        type: "decision",
        importance: 96,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
  });

  it("returns null so the caller can fall back when provider output is invalid", async () => {
    process.env.MEMORY_EXTRACTION_ENABLED = "true";
    process.env.MEMORY_EXTRACTOR_URL = "https://provider.test/v1/chat/completions";
    process.env.MEMORY_EXTRACTOR_MODEL = "test-model";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      ),
    );

    await expect(
      extractMemoryCandidatesWithModel({
        scope: "project",
        sourceText: "我们决定保留版本历史。",
      }),
    ).resolves.toBeNull();
  });
});
