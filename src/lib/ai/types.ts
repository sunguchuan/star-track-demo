/**
 * Hybrid AI types & contracts (UI → Gateway → Router → Ollama/Cloud).
 * StreamEvent order: run → meta → tool_call* / tool_result* → plan? → delta* → error? → usage? → done
 * `guardrail` events may appear anywhere before `done`.
 */
import type { ActionPlan } from "./action-plan";
export type AiTaskType =
  | "summarize"
  | "polish"
  | "continue"
  | "translate"
  | "tags"
  | "analyze"
  | "refactor"
  | "investigate"
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

export type GuardrailStage = "input" | "resource" | "tool" | "output";

/** block = request stopped; reroute = sent to local instead of cloud; redact = masked before cloud. */
export type GuardrailAction = "block" | "warn" | "redact" | "reroute" | "trim";

export type GuardrailHit = {
  stage: GuardrailStage;
  rule: string;
  action: GuardrailAction;
  message: string;
  detail?: string;
};

export type KnowledgeSource = {
  docId: string;
  title: string;
  heading: string;
  /** Reranker score 0–3; null when the results were not reranked. */
  relevance: number | null;
  /** Which retrievers found it: bm25 / vector. */
  matchedBy: string[];
};

export type StreamEvent =
  | { type: "run"; id: string }
  | ({ type: "guardrail" } & GuardrailHit)
  | {
      type: "meta";
      via: AiRouteTarget;
      model: string;
      reason: string;
      /** The standard model's Action Plan failed checks and was retried on the strong tier. */
      escalated?: boolean;
    }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      preview: string;
      /** Knowledge search: the document sections passed to the model. */
      sources?: KnowledgeSource[];
    }
  | {
      /** The answer is replayed from the cache; no model is called. */
      type: "cache";
      mode: "exact" | "semantic";
      similarity: number | null;
      entryId: string;
      sourceRunId: string;
      /** epoch ms of the original answer */
      createdAt: number;
      savedMs: number;
      savedUsd: number;
    }
  | { type: "plan"; plan: ActionPlan; ungroundedRefs: string[] }
  | { type: "delta"; text: string }
  | {
      type: "error";
      message: string;
      code?: string;
      hint?: string;
      retryable?: boolean;
    }
  | ({ type: "usage" } & RunUsage)
  | { type: "done" };

/** Token counts reported by one provider call. */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

/** Per-run usage across every model call (agent rounds, repairs, fallback attempts). */
export type RunUsage = TokenUsage & {
  calls: number;
  /** Cloud tokens × cloud price. */
  costUsd: number;
  /** Local tokens × cloud price — what the same work would have cost on cloud. */
  savedUsd: number;
};

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
  "investigate",
] as const;

/** ~2k Chinese chars ≈ prefer cloud for long input under auto. */
export const LONG_INPUT_CHARS = 2000;
