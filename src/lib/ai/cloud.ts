import {
  httpErrorToProviderError,
  toProviderError,
} from "./errors";
import type {
  ChatCompletionMessage,
  ChatCompletionResult,
  OpenAiTool,
  ToolCallRequest,
} from "./tools/types";
import type { ChatMessage } from "./types";

const CLOUD_BASE =
  process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ??
  "https://api.openai.com/v1";

type OpenAiStreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string; code?: string; type?: string };
};

type OpenAiCompletionResponse = {
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
}): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw httpErrorToProviderError({
      provider: "cloud",
      status: 401,
      detail: "未配置 OPENAI_API_KEY",
    });
  }

  const { model, messages, signal } = options;

  // Start streaming request
  let res: Response;
  try {
    res = await fetch(`${CLOUD_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal,
    });
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

        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    }
  } catch (err) {
    throw toProviderError(err, "cloud");
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
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw httpErrorToProviderError({
      provider: "cloud",
      status: 401,
      detail: "未配置 OPENAI_API_KEY",
    });
  }

  const { model, messages, tools, toolChoice, signal } = options;

  let res: Response;
  try {
    res = await fetch(`${CLOUD_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(tools?.length
          ? {
              tools,
              tool_choice: toolChoice ?? "auto",
            }
          : {}),
      }),
      signal,
    });
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
