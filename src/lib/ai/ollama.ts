import {
  httpErrorToProviderError,
  toProviderError,
} from "./errors";
import type { ChatMessage } from "./types";

const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:11434";

type OllamaChatChunk = {
  message?: { content?: string };
  done?: boolean;
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

export function getOllamaBaseUrl() {
  return OLLAMA_BASE;
}
