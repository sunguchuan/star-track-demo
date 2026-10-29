/**
 * Generic one-round runner for tool-using specialists.
 *
 * A specialist selects tools from its own allowlist (or uses its deterministic
 * fallback), the server executes them, and the transcript is returned to the
 * coordinator. Keeping this generic means a new specialist is a definition,
 * not another copy of the tool loop.
 */
import { ACTION_PLAN_SECTIONS } from "../../action-plan";
import { compactToolResult, type SeenRows } from "../../compress";
import { completeCloudChat } from "../../cloud";
import type { ReplyLanguage } from "../../language";
import { completeOllamaChat } from "../../ollama";
import { executeToolViaLangChain } from "../../tools/langchain";
import { isAllowedTool, toOpenAiTools } from "../../tools/registry";
import type {
  ChatCompletionMessage,
  ToolCallRequest,
  ToolDefinition,
} from "../../tools/types";
import {
  promptPreview,
  recordGuardrails,
  traceGeneration,
  type Span,
} from "../../trace";
import type { GuardrailHit, StreamEvent } from "../../types";
import type { ModelExecutionContext } from "../types";
import { guardrailEvent } from "../events";
import { toolCallSource, withOpenAlerts } from "./types-helpers";
import {
  emptySpecialistResult,
  type SpecialistDefinition,
  type SpecialistResult,
  type SpecialistRunContext,
  type ToolPayloadStats,
} from "./types";

const PREVIEW_CHARS = 480;
const MAX_TOOL_CALLS = 5;
const MAX_TOOL_PAYLOAD_CHARS = 12_000;

/**
 * A short tool-less reply can be a refusal, identity answer or clarification.
 * Longer replies, data claims and plan sections are treated as analysis
 * written without evidence and therefore do not qualify.
 */
const DIRECT_REPLY_MAX_CHARS: Record<ReplyLanguage, number> = { zh: 200, en: 600 };
const DATA_CLAIM_PATTERN =
  /\bB-\d{6}-\d{2}\b|\bT-[A-Z]+-\d+\b|\b[A-Z]{2,}(?:-[A-Z0-9]{2,})+\b|\d(?:\.\d+)?\s*%/;

export function capPayload(payload: string): string {
  if (payload.length <= MAX_TOOL_PAYLOAD_CHARS) return payload;
  return `${payload.slice(0, MAX_TOOL_PAYLOAD_CHARS)}…(truncated ${payload.length - MAX_TOOL_PAYLOAD_CHARS} chars)`;
}

function previewJson(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 0);
  if (text.length <= PREVIEW_CHARS) return text;
  return `${text.slice(0, PREVIEW_CHARS)}…`;
}

export function isDirectReply(text: string, language: ReplyLanguage): boolean {
  if (!text || text.length >= DIRECT_REPLY_MAX_CHARS[language]) return false;
  if (DATA_CLAIM_PATTERN.test(text)) return false;
  const sections = ACTION_PLAN_SECTIONS.filter(
    (section) =>
      text.includes(section.zh) || new RegExp(`\\b${section.en}`, "i").test(text),
  );
  return sections.length < 2;
}

/** Tool result as the model sees it; share `seen` across one round for dedupe. */
export function toolResultContent(
  data: unknown,
  compress: boolean,
  seen: SeenRows = new Set(),
): string {
  return capPayload(compress ? compactToolResult(data, seen) : JSON.stringify(data));
}

type CallOptions = ModelExecutionContext & { span: Span };

function completeWithTools(
  options: CallOptions & {
    messages: ChatCompletionMessage[];
    tools: ToolDefinition[];
  },
) {
  const tools = toOpenAiTools(options.tools);
  return traceGeneration(
    options.span,
    "llm.select_tools",
    {
      target: options.target,
      model: options.model,
      input: promptPreview(options.messages),
      metadata: { tools: tools.map((tool) => tool.function.name) },
    },
    (span) =>
      options.target === "cloud"
        ? completeCloudChat({
            model: options.model,
            messages: options.messages,
            tools,
            toolChoice: "auto",
            signal: options.signal,
            onUsage: span.usageSink(options.onUsage),
          })
        : completeOllamaChat({
            model: options.model,
            messages: options.messages,
            tools,
            signal: options.signal,
            onUsage: span.usageSink(options.onUsage),
          }),
    (result) =>
      result.toolCalls.length > 0
        ? result.toolCalls.map((call) => ({ name: call.name, arguments: call.arguments }))
        : result.content,
  );
}

/** Allowlist, dedupe and cap model-selected calls before anything executes. */
function screenToolCalls(
  calls: ToolCallRequest[],
  definitions: ToolDefinition[],
): { calls: ToolCallRequest[]; hits: GuardrailHit[] } {
  const hits: GuardrailHit[] = [];
  const seen = new Set<string>();
  const allowed: ToolCallRequest[] = [];
  const rejected: string[] = [];

  for (const call of calls) {
    if (!isAllowedTool(call.name, definitions)) {
      rejected.push(call.name.slice(0, 40));
      continue;
    }
    const key = `${call.name}:${call.arguments.replace(/\s+/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allowed.push(call);
  }

  if (rejected.length > 0) {
    hits.push({
      stage: "tool",
      rule: "tool_not_allowed",
      action: "block",
      message: "模型请求了未授权的工具，已拒绝执行",
      detail: rejected.join(", "),
    });
  }

  if (allowed.length > MAX_TOOL_CALLS) {
    hits.push({
      stage: "tool",
      rule: "tool_call_cap",
      action: "trim",
      message: `单轮工具调用超过 ${MAX_TOOL_CALLS} 次，只执行前 ${MAX_TOOL_CALLS} 个`,
      detail: allowed
        .slice(MAX_TOOL_CALLS)
        .map((call) => call.name)
        .join(", "),
    });
  }

  return { calls: allowed.slice(0, MAX_TOOL_CALLS), hits };
}

async function* emitToolRound(
  calls: ToolCallRequest[],
  messages: ChatCompletionMessage[],
  parent: Span,
  context: SpecialistRunContext,
  evidence: string[],
  stats: ToolPayloadStats,
): AsyncGenerator<StreamEvent> {
  const invalidArgs: string[] = [];
  const seen: SeenRows = new Set();
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
      ...(call.thoughtSignature
        ? { thought_signature: call.thoughtSignature }
        : {}),
    })),
  });

  for (const call of calls) {
    if (context.execution.signal.aborted) return;

    yield {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    };

    const toolSpan = parent.child(`tool.${call.name}`, "tool", {
      input: call.arguments,
      metadata: { callId: call.id, source: toolCallSource(call.id) },
    });
    // Execute through the LangChain tool adapter so specialists share the same
    // StructuredTool interface, while still receiving our ToolResult shape.
    const executed = await executeToolViaLangChain(call.name, call.arguments, {
      target: context.execution.target,
      signal: context.execution.signal,
      span: toolSpan,
      onUsage: context.execution.onUsage,
      language: context.language,
    });
    const raw = executed.ok
      ? JSON.stringify(executed.data)
      : JSON.stringify({ error: executed.error });
    const payload = !executed.ok
      ? capPayload(raw)
      : executed.content != null
        ? capPayload(executed.content)
        : toolResultContent(executed.data, context.compress, seen);
    stats.rawChars += raw.length;
    stats.sentChars += payload.length;
    toolSpan.end(
      executed.ok
        ? { output: payload, metadata: { rawChars: raw.length, sentChars: payload.length } }
        : {
            output: payload,
            status: "error",
            statusMessage: `${executed.kind}: ${executed.error}`,
          },
    );
    if (executed.ok) {
      // Grounding checks accept either rendering; compact output drops some timestamp text.
      evidence.push(raw);
      if (payload !== raw) evidence.push(payload);
    } else if (executed.kind === "invalid_args") {
      invalidArgs.push(`${call.name}: ${executed.error}`);
    }

    yield {
      type: "tool_result",
      id: call.id,
      name: call.name,
      ok: executed.ok,
      preview: previewJson(
        !executed.ok ? { error: executed.error } : (executed.content ?? executed.data),
      ),
      ...(executed.ok && executed.sources ? { sources: executed.sources } : {}),
    };

    messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: payload,
    });
  }

  if (invalidArgs.length > 0) {
    yield guardrailEvent({
      stage: "tool",
      rule: "tool_invalid_args",
      action: "block",
      message: "工具参数未通过校验，未查询数据库",
      detail: invalidArgs.join("; ").slice(0, 300),
    });
  }
}

/** Run one specialist for the current request. */
export async function gatherSpecialist(
  definition: SpecialistDefinition,
  context: SpecialistRunContext,
): Promise<SpecialistResult> {
  const tools = definition.listTools();
  if (tools.length === 0) return emptySpecialistResult();

  const span = context.parentSpan.child(definition.spanName, "agent", {
    metadata: { specialist: definition.id, tools: tools.map((tool) => tool.name) },
  });
  const result: SpecialistResult = {
    ...emptySpecialistResult(),
    skipped: false,
  };
  const messages: ChatCompletionMessage[] = [
    {
      role: "system",
      content: definition.createSystemPrompt(context.language),
    },
    { role: "user", content: context.userInput },
  ];
  let toolCalls = definition.createFallbackCalls(context.userInput);

  try {
    const first = await completeWithTools({
      ...context.execution,
      span,
      messages,
      tools,
    });
    if (first.toolCalls.length > 0) {
      const screened = screenToolCalls(first.toolCalls, tools);
      recordGuardrails(span, "guardrails.tools", screened.hits);
      for (const hit of screened.hits) result.events.push(guardrailEvent(hit));
      if (screened.calls.length > 0) {
        toolCalls = definition.policy?.topUpOpenAlerts
          ? withOpenAlerts(screened.calls, MAX_TOOL_CALLS)
          : screened.calls;
      }
    } else if (definition.policy?.allowDirectReply) {
      const text = first.content?.trim() ?? "";
      if (isDirectReply(text, context.language)) result.directReply = text;
    }
  } catch {
    // Model unavailable: retain the deterministic fallback calls.
  }

  if (context.execution.signal.aborted || result.directReply) {
    span.end({
      metadata: {
        outcome: result.directReply ? "direct_reply" : "aborted",
      },
    });
    return result;
  }

  for await (const event of emitToolRound(
    toolCalls,
    messages,
    span,
    context,
    result.evidence,
    result.payloadStats,
  )) {
    result.events.push(event);
  }

  result.toolMessages = messages.slice(2);
  span.end({
    metadata: { toolPayload: result.payloadStats, toolCalls: toolCalls.length },
  });
  return result;
}