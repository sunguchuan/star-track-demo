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

const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:11434";

type OllamaChatChunk = {
  message?: { content?: string };
  done?: boolean;
  error?: string;
};

type OllamaToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
};

/**
 * Call Ollama — POST {OLLAMA_BASE}/api/chat (native NDJSON stream).
 * Parse each line's chunk.message.content and yield tokens to the Gateway.
 */
export async function* streamOllamaChat(options: {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const { model, messages, signal } = options;

  // Start streaming; connection failures become ollama_offline for cloud fallback
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    throw toProviderError(err, "local");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({
      provider: "local",
      status: res.status,
      detail: detail || res.statusText,
    });
  }

  if (!res.body) {
    throw toProviderError(new Error("Ollama 未返回流式响应体"), "local");
  }

  // Read NDJSON: one JSON object per line
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
        if (!trimmed) continue;

        let chunk: OllamaChatChunk;
        try {
          chunk = JSON.parse(trimmed) as OllamaChatChunk;
        } catch {
          continue;
        }

        if (chunk.error) {
          throw httpErrorToProviderError({
            provider: "local",
            status: /not found|pull/i.test(chunk.error) ? 404 : 400,
            detail: chunk.error,
          });
        }

        const text = chunk.message?.content;
        if (text) {
          yield text;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
      } catch {
        // ignore trailing partial
      }
    }
  } catch (err) {
    throw toProviderError(err, "local");
  }
}

function normalizeToolArgs(
  args: string | Record<string, unknown> | undefined,
): string {
  if (args == null) return "{}";
  if (typeof args === "string") return args || "{}";
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

/**
 * Non-streaming Ollama chat — used by the tool-calling agent loop.
 * Ollama accepts OpenAI-style `tools` on /api/chat when stream=false.
 */
export async function completeOllamaChat(options: {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: OpenAiTool[];
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const { model, messages, tools, signal } = options;

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(tools?.length ? { tools } : {}),
      }),
      signal,
    });
  } catch (err) {
    throw toProviderError(err, "local");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({
      provider: "local",
      status: res.status,
      detail: detail || res.statusText,
    });
  }

  let data: OllamaChatResponse;
  try {
    data = (await res.json()) as OllamaChatResponse;
  } catch (err) {
    throw toProviderError(err, "local");
  }

  if (data.error) {
    throw httpErrorToProviderError({
      provider: "local",
      status: /not found|pull/i.test(data.error) ? 404 : 400,
      detail: data.error,
    });
  }

  const toolCalls: ToolCallRequest[] = (data.message?.tool_calls ?? [])
    .map((call, index) => {
      const name = call.function?.name?.trim();
      if (!name) return null;
      return {
        id: call.id?.trim() || `ollama_${index}_${name}`,
        name,
        arguments: normalizeToolArgs(call.function?.arguments),
      };
    })
    .filter((c): c is ToolCallRequest => c != null);

  return {
    content: data.message?.content ?? null,
    toolCalls,
  };
}

export function getOllamaBaseUrl() {
  return OLLAMA_BASE;
}
