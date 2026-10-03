import {
  httpErrorToProviderError,
  toProviderError,
} from "./errors";
import { MAX_OUTPUT_TOKENS } from "./guardrails/resource";
import type {
  ChatCompletionMessage,
  ChatCompletionResult,
  OpenAiTool,
  ToolCallRequest,
} from "./tools/types";
import type { ChatMessage, TokenUsage } from "./types";

const CLOUD_BASE =
  process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ??
  "https://api.openai.com/v1";

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 800;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) return abort();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        abort();
      },
      { once: true },
    );
  });
}

/**
 * POST chat/completions, retrying once on transient 5xx.
 * Safe to retry: these statuses arrive before any tokens are streamed.
 */
async function postChatCompletions(
  apiKey: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const send = () =>
    fetch(`${CLOUD_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });

  const first = await send();
  if (!RETRYABLE_STATUS.has(first.status)) return first;

  await first.body?.cancel().catch(() => {});
  await sleep(RETRY_DELAY_MS, signal);
  return send();
}

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAiStreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: OpenAiUsage | null;
  error?: { message?: string; code?: string; type?: string };
};

/** Gemini bills thinking tokens as output but may leave them out of completion_tokens. */
function toTokenUsage(usage: OpenAiUsage | null | undefined): TokenUsage | null {
  if (!usage || usage.prompt_tokens == null) return null;
  const prompt = usage.prompt_tokens;
  const completion = Math.max(
    usage.completion_tokens ?? 0,
    (usage.total_tokens ?? 0) - prompt,
  );
  return { promptTokens: prompt, completionTokens: completion };
}

export type JsonSchemaFormat = {
  name: string;
  schema: Record<string, unknown>;
};

type OpenAiCompletionResponse = {
  usage?: OpenAiUsage;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
        thought_signature?: string;
      }>;
    };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

/**
 * Call cloud — OpenAI-compatible chat/completions (incl. Gemini OpenAI layer).
 * Parse SSE `data:` lines and yield delta.content.
 */
export async function* streamCloudChat(options: {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw httpErrorToProviderError({
      provider: "cloud",
      status: 401,
      detail: "未配置 OPENAI_API_KEY",
    });
  }

  const { model, messages, signal, onUsage } = options;

  // Start streaming request
  let res: Response;
  try {
    res = await postChatCompletions(
      apiKey,
      {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: MAX_OUTPUT_TOKENS,
      },
      signal,
    );
  } catch (err) {
    throw toProviderError(err, "cloud");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({
      provider: "cloud",
      status: res.status,
      detail: detail || res.statusText,
    });
  }

  if (!res.body) {
    throw toProviderError(new Error("云端未返回流式响应体"), "cloud");
  }

  // Read SSE: data: {...} / data: [DONE]
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Usage is cumulative per chunk (Gemini) or only on the last one (OpenAI); keep the latest.
  let usage: TokenUsage | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;

        let chunk: OpenAiStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiStreamChunk;
        } catch {
          continue;
        }

        if (chunk.error?.message) {
          throw httpErrorToProviderError({
            provider: "cloud",
            status: 400,
            detail: chunk.error.message,
          });
        }

        usage = toTokenUsage(chunk.usage) ?? usage;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    }
  } catch (err) {
    throw toProviderError(err, "cloud");
  } finally {
    // Also runs on [DONE] return and on consumer break, so partial runs are still counted.
    if (usage) onUsage?.(usage);
  }
}

/**
 * Non-streaming cloud completion — used by the tool-calling agent loop.
 */
export async function completeCloudChat(options: {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: OpenAiTool[];
  toolChoice?: "auto" | "none" | "required";
  /** Constrain the reply to a JSON schema (structured output). */
  jsonSchema?: JsonSchemaFormat;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw httpErrorToProviderError({
      provider: "cloud",
      status: 401,
      detail: "未配置 OPENAI_API_KEY",
    });
  }

  const { model, messages, tools, toolChoice, jsonSchema, signal, onUsage } = options;

  let res: Response;
  try {
    res = await postChatCompletions(
      apiKey,
      {
        model,
        messages,
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(tools?.length
          ? {
              tools,
              tool_choice: toolChoice ?? "auto",
            }
          : {}),
        ...(jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { ...jsonSchema, strict: true },
              },
            }
          : {}),
      },
      signal,
    );
  } catch (err) {
    throw toProviderError(err, "cloud");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({
      provider: "cloud",
      status: res.status,
      detail: detail || res.statusText,
    });
  }

  let data: OpenAiCompletionResponse;
  try {
    data = (await res.json()) as OpenAiCompletionResponse;
  } catch (err) {
    throw toProviderError(err, "cloud");
  }

  if (data.error?.message) {
    throw httpErrorToProviderError({
      provider: "cloud",
      status: 400,
      detail: data.error.message,
    });
  }

  const usage = toTokenUsage(data.usage);
  if (usage) onUsage?.(usage);

  const message = data.choices?.[0]?.message;
  const toolCalls: ToolCallRequest[] = [];
  for (const [index, call] of (message?.tool_calls ?? []).entries()) {
    const name = call.function?.name?.trim();
    if (!name) continue;
    const entry: ToolCallRequest = {
      id: call.id?.trim() || `call_${index}_${name}`,
      name,
      arguments: call.function?.arguments ?? "{}",
    };
    if (call.thought_signature) {
      entry.thoughtSignature = call.thought_signature;
    }
    toolCalls.push(entry);
  }

  return {
    content: message?.content ?? null,
    toolCalls,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}
