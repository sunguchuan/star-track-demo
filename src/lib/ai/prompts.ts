import type { AiTaskType, ChatMessage } from "./types";

/** Per-task system prompts — instruction layer of the AI framework */
const TASK_PROMPTS: Record<AiTaskType, string> = {
  summarize: "用简洁中文总结用户给出的文本，保留关键事实，不要编造。",
  polish: "润色用户文本：更清晰、自然，保持原意与语气，直接输出改写结果。",
  continue: "基于用户文本自然续写一小段，风格一致，不要重复原文。",
  translate: "将用户文本翻译成流畅中文；若已是中文则译成英文。只输出译文。",
  tags: "从文本提取 3–8 个中文关键词标签，用逗号分隔，不要解释。",
  analyze:
    "深入分析用户文本：结构、要点、隐含问题与可执行建议。用中文分点说明。",
  refactor:
    "若内容是代码则给出重构建议与示例；否则给出更清晰的结构化改写。用中文说明。",
  chat: "你是本地优先的笔记助手。简洁、准确、用中文回答。",
};

/**
 * Step 3 — Build chat messages:
 * [system prompt by taskType] + [optional history] + [current user input]
 */
export function buildMessages(
  taskType: AiTaskType,
  input: string,
  prior: ChatMessage[] = [],
): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content: TASK_PROMPTS[taskType],
  };

  const history = prior.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return [
    system,
    ...history,
    { role: "user", content: input },
  ];
}
