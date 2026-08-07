export type AiTaskType =
  | "summarize"
  | "polish"
  | "continue"
  | "translate"
  | "tags"
  | "analyze"
  | "refactor"
  | "chat";

export type AiStrategy = "auto" | "only-local" | "only-cloud";

export type AiRouteTarget = "local" | "cloud";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequestBody = {
  input: string;
  taskType?: AiTaskType;
  strategy?: AiStrategy;
  /** Optional prior turns (excluding the current user input). */
  messages?: ChatMessage[];
};

export type RouteDecision = {
  target: AiRouteTarget;
  reason: string;
  model: string;
};

export type StreamEvent =
  | { type: "meta"; via: AiRouteTarget; model: string; reason: string }
  | { type: "delta"; text: string }
  | {
      type: "error";
      message: string;
      code?: string;
      hint?: string;
      retryable?: boolean;
    }
  | { type: "done" };

export const LOCAL_TASKS: readonly AiTaskType[] = [
  "summarize",
  "polish",
  "continue",
  "translate",
  "tags",
  "chat",
] as const;

export const CLOUD_TASKS: readonly AiTaskType[] = [
  "analyze",
  "refactor",
] as const;

/** ~2k Chinese chars ≈ prefer cloud for long input under auto. */
export const LONG_INPUT_CHARS = 2000;
