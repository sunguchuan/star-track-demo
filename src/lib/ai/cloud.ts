import {
  httpErrorToProviderError,
  toProviderError,
} from "./errors";
import type { ChatMessage } from "./types";

const CLOUD_BASE =
  process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ??
  "https://api.openai.com/v1";

type OpenAiStreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string; code?: string; type?: string };
};

/** Stream from an OpenAI-compatible chat completions API. */
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
