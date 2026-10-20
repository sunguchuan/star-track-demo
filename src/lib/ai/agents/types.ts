/**
 * Agent contract used by the Gateway registry.
 * The Gateway only looks up a taskType and runs whatever load() returns;
 * it does not import a specific agent module.
 */
import type { Span, UsageCallback } from "../trace";
import type { AiRouteTarget, AiTaskType, StreamEvent } from "../types";

export type AgentRunOptions = {
  target: AiRouteTarget;
  /** Model for tool selection, and for the plan unless planModel is set. */
  model: string;
  /** Strong tier for the Action Plan on complex requests (cloud only). */
  planModel?: string | null;
  /** Strong tier to retry a failed / ungrounded plan from the standard model (cloud only). */
  escalationModel?: string | null;
  userInput: string;
  signal: AbortSignal;
  /** Called once per model call that reports token usage, with the model that produced it. */
  onUsage?: UsageCallback;
  /** Parent span (the Gateway attempt); a detached trace is used when omitted. */
  span?: Span;
};

/** Model settings shared by every specialist and the planner in one run. */
export type ModelExecutionContext = {
  target: AiRouteTarget;
  /** Standard model for tool selection and, unless overridden, planning. */
  model: string;
  signal: AbortSignal;
  onUsage?: UsageCallback;
};

export type AgentRunner = (options: AgentRunOptions) => AsyncGenerator<StreamEvent>;

export type AgentDefinition = {
  taskType: AiTaskType;
  /** Lazy so plain chat never pulls agent-side dependencies (e.g. node:sqlite). */
  load: () => Promise<AgentRunner>;
  /** Fingerprint for the answer cache when the answer depends on external data. */
  dataVersion?: () => Promise<string>;
};
