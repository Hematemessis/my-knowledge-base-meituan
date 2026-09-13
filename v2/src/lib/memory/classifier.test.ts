import { describe, expect, it } from "vitest";

import { classifyMemoryTypeLocally } from "./classifier";

describe("memory type classifier fallback", () => {
  it.each([
    ["我偏好简洁的界面。", "preference"],
    ["我们决定默认让 AI 自动分类。", "decision"],
    ["接下来要完成可搜索的事件时间线。", "goal"],
    ["每次保存前都要让用户确认。", "workflow"],
    ["今天已经完成了文件上传。", "episode"],
    ["项目使用 PostgreSQL 保存数据。", "fact"],
  ] as const)("classifies %s as %s", (statement, expected) => {
    expect(classifyMemoryTypeLocally(statement)).toBe(expected);
  });
});
