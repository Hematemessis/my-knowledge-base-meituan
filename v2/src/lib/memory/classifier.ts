import { classifyMemoryTypeWithProvider } from "@/lib/assistant/provider";

import type { MemoryType } from "./types";

const localRules: Array<{ type: MemoryType; patterns: string[] }> = [
  {
    type: "preference",
    patterns: ["我喜欢", "我偏好", "我更喜欢", "我不喜欢", "我习惯", "我的风格"],
  },
  {
    type: "decision",
    patterns: ["决定", "确定", "采用", "选择", "必须", "优先", "不再", "改为", "保持"],
  },
  {
    type: "goal",
    patterns: ["目标", "希望实现", "计划达成", "接下来要", "最终要", "里程碑"],
  },
  {
    type: "workflow",
    patterns: ["每次", "默认先", "流程", "工作方式", "固定步骤", "都要"],
  },
  {
    type: "episode",
    patterns: ["今天", "昨天", "刚刚", "本周", "上周", "已经完成", "这次"],
  },
];

export function classifyMemoryTypeLocally(statement: string): MemoryType {
  return (
    localRules.find((rule) =>
      rule.patterns.some((pattern) => statement.includes(pattern)),
    )?.type ?? "fact"
  );
}

export async function classifyMemoryType(statement: string): Promise<{
  type: MemoryType;
  mode: "model" | "heuristic";
}> {
  const modelType = await classifyMemoryTypeWithProvider(statement);
  if (modelType) return { type: modelType, mode: "model" };
  return { type: classifyMemoryTypeLocally(statement), mode: "heuristic" };
}
