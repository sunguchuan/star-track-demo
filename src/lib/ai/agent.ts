/**
 * Tool-calling agent loop for taskType=investigate.
 * Emits tool_call / tool_result / delta StreamEvents; Gateway forwards them as SSE.
 *
 * Strategy: at most one tool round (model-chosen or forced), then stream the Action Plan.
 * Avoids multi-turn Gemini thought_signature issues while still demonstrating tools.
 */
import { completeCloudChat, streamCloudChat } from "./cloud";
import { completeOllamaChat, streamOllamaChat } from "./ollama";
import { executeFabTool } from "./tools/fab";
import { toOpenAiTools } from "./tools/registry";
import type { ChatCompletionMessage } from "./tools/types";
import type { AiRouteTarget, ChatMessage, StreamEvent } from "./types";

const PREVIEW_CHARS = 480;

const INVESTIGATE_SYSTEM = `You are a semiconductor fab manufacturing co-pilot.
Use the provided tools to query real batch / yield / alert data before concluding.
Do not invent batch IDs, yields, or alert codes — only cite tool results.
When you have enough evidence, write a concise Action Plan in Chinese with exactly these sections:
1. 现象（事实）
2. 可能原因
3. 建议动作（可执行）
4. 需确认的数据
Keep it practical for a process / yield engineer.`;

function previewJson(value: unknown): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 0);
  if (text.length <= PREVIEW_CHARS) return text;
  return `${text.slice(0, PREVIEW_CHARS)}…`;
}

function forceGatherTools(): Array<{
  id: string;
  name: string;
  arguments: string;
}> {
  return [
    { id: "force_summary", name: "get_fab_summary", arguments: "{}" },
    {
      id: "force_alerts",
      name: "list_fab_alerts",
      arguments: JSON.stringify({ limit: 10, openOnly: true }),
    },
    {
      id: "force_batches",
      name: "list_fab_batches",
      arguments: JSON.stringify({ limit: 8 }),
    },
  ];
}

async function completeWithTools(options: {
  target: AiRouteTarget;
  model: string;
  messages: ChatCompletionMessage[];
  signal: AbortSignal;
}) {
  const tools = toOpenAiTools();
  if (options.target === "cloud") {
    return completeCloudChat({
      model: options.model,
      messages: options.messages,
      tools,
      toolChoice: "auto",
      signal: options.signal,
    });
  }
  return completeOllamaChat({
    model: options.model,
    messages: options.messages,
    tools,
    signal: options.signal,
  });
}

async function* streamFinalAnswer(options: {
  target: AiRouteTarget;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  if (options.target === "cloud") {
    yield* streamCloudChat({
      model: options.model,
      messages: options.messages,
      signal: options.signal,
    });
    return;
  }
  yield* streamOllamaChat({
    model: options.model,
    messages: options.messages,
    signal: options.signal,
  });
}

function toStreamMessages(
  messages: ChatCompletionMessage[],
): ChatMessage[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user" as const,
        content: `[Tool ${m.name} result]\n${m.content ?? ""}`,
      };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content:
          m.content?.trim() ||
          `(called tools: ${m.tool_calls.map((c) => c.function.name).join(", ")})`,
      };
    }
    return {
      role: m.role as "system" | "user" | "assistant",
      content: m.content ?? "",
    };
  });
}

async function* emitToolRound(
  calls: Array<{
    id: string;
    name: string;
    arguments: string;
    thoughtSignature?: string;
  }>,
  messages: ChatCompletionMessage[],
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
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
    if (signal.aborted) return;

    yield {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    };

    const executed = executeFabTool(call.name, call.arguments);
    const payload = executed.ok
      ? JSON.stringify(executed.data)
      : JSON.stringify({ error: executed.error });

    yield {
      type: "tool_result",
      id: call.id,
      name: call.name,
      ok: executed.ok,
      preview: previewJson(
        executed.ok ? executed.data : { error: executed.error },
      ),
    };

    messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: payload,
    });
  }
}

export async function* runInvestigateAgent(options: {
  target: AiRouteTarget;
  model: string;
  userInput: string;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: INVESTIGATE_SYSTEM },
    { role: "user", content: options.userInput },
  ];

  let toolCalls = forceGatherTools();

  try {
    const first = await completeWithTools({
      target: options.target,
      model: options.model,
      messages,
      signal: options.signal,
    });
    if (first.toolCalls.length > 0) {
      toolCalls = first.toolCalls;
    }
  } catch {
    // Model/tools unavailable — still gather FAB data deterministically.
  }

  if (options.signal.aborted) return;

  yield* emitToolRound(toolCalls, messages, options.signal);

  const streamMessages = toStreamMessages(messages);
  streamMessages.push({
    role: "user",
    content:
      "Based only on the tool results above, write the Action Plan now. Do not invent numbers. Do not call tools again.",
  });

  for await (const text of streamFinalAnswer({
    target: options.target,
    model: options.model,
    messages: streamMessages,
    signal: options.signal,
  })) {
    if (options.signal.aborted) return;
    yield { type: "delta", text };
  }
}
