/**
 * Contracts for tool-using specialists inside an Agent workflow.
 *
 * A definition describes a specialist's stable identity and policies; a run context
 * carries only the values that change per request. Planner and reviewer roles have
 * different inputs and outputs, so they do not inherit this interface.
 */
import type { ReplyLanguage } from "../../language";
import type { Span } from "../../trace";
import type { ChatCompletionMessage, ToolCallRequest, ToolDefinition } from "../../tools/types";
import type { StreamEvent } from "../../types";
import type { ModelExecutionContext } from "../types";

export type ToolSpecialistId = "data" | "procedure";

export interface SpecialistPolicy {
  /** Append open alerts when the model did not request them. */
  topUpOpenAlerts?: boolean;
  /** Allow a short tool-less reply to end the whole workflow. */
  allowDirectReply?: boolean;
}

export interface SpecialistDefinition {
  id: ToolSpecialistId;
  spanName: string;
  createSystemPrompt: (language: ReplyLanguage) => string;
  listTools: () => ToolDefinition[];
  createFallbackCalls: (userInput: string) => ToolCallRequest[];
  policy?: SpecialistPolicy;
}

export interface SpecialistRunContext {
  parentSpan: Span;
  userInput: string;
  language: ReplyLanguage;
  compress: boolean;
  execution: ModelExecutionContext;
}

export interface ToolPayloadStats {
  rawChars: number;
  sentChars: number;
}

export interface SpecialistResult {
  skipped: boolean;
  events: StreamEvent[];
  evidence: string[];
  toolMessages: ChatCompletionMessage[];
  directReply: string;
  payloadStats: ToolPayloadStats;
}

export function emptySpecialistResult(): SpecialistResult {
  return {
    skipped: true,
    events: [],
    evidence: [],
    toolMessages: [],
    directReply: "",
    payloadStats: { rawChars: 0, sentChars: 0 },
  };
}
