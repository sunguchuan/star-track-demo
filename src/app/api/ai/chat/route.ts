import { streamCloudChat } from "@/lib/ai/cloud";
import {
  shouldFallbackToCloud,
  shouldFallbackToLocal,
  toProviderError,
  type AiProviderError,
} from "@/lib/ai/errors";
import { streamOllamaChat } from "@/lib/ai/ollama";
import { buildMessages } from "@/lib/ai/prompts";
import {
  getCloudModel,
  getLocalModel,
  isCloudConfigured,
  isLocalAiRuntime,
  resolveRoute,
} from "@/lib/ai/router";
import { createSseResponse, sseEncode } from "@/lib/ai/sse";
import type {
  AiStrategy,
  AiTaskType,
  ChatMessage,
  ChatRequestBody,
  StreamEvent,
} from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_TYPES = new Set<AiTaskType>([
  "summarize",
  "polish",
  "continue",
  "translate",
  "tags",
  "analyze",
  "refactor",
  "chat",
]);

const STRATEGIES = new Set<AiStrategy>(["auto", "only-local", "only-cloud"]);

function parseBody(raw: unknown): ChatRequestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.input !== "string") return null;
  return {
    input: body.input,
    taskType:
      typeof body.taskType === "string" &&
      TASK_TYPES.has(body.taskType as AiTaskType)
        ? (body.taskType as AiTaskType)
        : "chat",
    strategy:
      typeof body.strategy === "string" &&
      STRATEGIES.has(body.strategy as AiStrategy)
        ? (body.strategy as AiStrategy)
        : "auto",
    messages: Array.isArray(body.messages)
      ? (body.messages as ChatMessage[])
      : [],
  };
}

function errorEvent(err: AiProviderError): StreamEvent {
  return {
    type: "error",
    message: err.message,
    code: err.code,
    hint: err.hint || undefined,
    retryable: err.retryable,
  };
}

async function* runModel(options: {
  target: "local" | "cloud";
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

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "无效 JSON" }, { status: 400 });
  }

  const body = parseBody(json);
  if (!body || !body.input.trim()) {
    return Response.json({ error: "input 不能为空" }, { status: 400 });
  }

  const taskType = body.taskType ?? "chat";
  const strategy = body.strategy ?? "auto";
  const cloudAvailable = isCloudConfigured();
  const localRuntime = isLocalAiRuntime();
  const decision = resolveRoute({
    taskType,
    strategy,
    inputLength: body.input.trim().length,
    cloudAvailable,
    localRuntime,
  });

  const messages = buildMessages(taskType, body.input.trim(), body.messages);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

      let via = decision.target;
      let model = decision.model;
      let reason = decision.reason;

      push({ type: "meta", via, model, reason });

      // Hosted without Key: fail clearly — never attempt Ollama on the server.
      if (!localRuntime && !cloudAvailable) {
        push({
          type: "error",
          message: "线上环境未配置云端 API Key",
          code: "auth",
          hint: "请在 Vercel → Project → Settings → Environment Variables 添加 OPENAI_API_KEY、OPENAI_BASE_URL、CLOUD_MODEL（与本地 .env.local 相同）。",
          retryable: false,
        });
        push({ type: "done" });
        controller.close();
        return;
      }

      // Safety: never call local provider off local runtime.
      if (!localRuntime && via === "local") {
        via = "cloud";
        model = getCloudModel();
        reason = "线上环境已强制改走云端";
        push({ type: "meta", via, model, reason });
      }

      try {
        try {
          for await (const text of runModel({
            target: via,
            model,
            messages,
            signal: request.signal,
          })) {
            if (request.signal.aborted) break;
            push({ type: "delta", text });
          }
        } catch (err) {
          const providerErr = toProviderError(err, via);

          // Local unreachable → cloud (any strategy, if Key present)
          if (
            via === "local" &&
            localRuntime &&
            cloudAvailable &&
            shouldFallbackToCloud(providerErr)
          ) {
            const cloudModel = getCloudModel();
            push({
              type: "error",
              message: `${providerErr.message}，正在改用云端…`,
              code: providerErr.code,
              hint: providerErr.hint,
              retryable: true,
            });

            via = "cloud";
            model = cloudModel;
            reason = "本地不可用，已自动改走云端";
            push({ type: "meta", via, model, reason });

            for await (const text of runModel({
              target: "cloud",
              model: cloudModel,
              messages,
              signal: request.signal,
            })) {
              if (request.signal.aborted) break;
              push({ type: "delta", text });
            }
          } else if (
            // Cloud quota/rate-limit → local (only when local runtime makes sense)
            via === "cloud" &&
            localRuntime &&
            strategy === "auto" &&
            shouldFallbackToLocal(providerErr)
          ) {
            const localModel = getLocalModel();
            push({
              type: "error",
              message: `${providerErr.message}，正在降级到本地…`,
              code: providerErr.code,
              hint: providerErr.hint,
              retryable: true,
            });

            via = "local";
            model = localModel;
            reason = `云端${providerErr.code === "quota_exhausted" ? "额度不足" : "限流"}，已自动降级本地`;
            push({ type: "meta", via, model, reason });

            for await (const text of runModel({
              target: "local",
              model: localModel,
              messages,
              signal: request.signal,
            })) {
              if (request.signal.aborted) break;
              push({ type: "delta", text });
            }
          } else if (providerErr.code !== "aborted") {
            push(errorEvent(providerErr));
          }
        }

        push({ type: "done" });
      } catch (err) {
        const providerErr = toProviderError(err, via);
        if (providerErr.code !== "aborted") {
          push(errorEvent(providerErr));
        }
        push({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return createSseResponse(stream, {
    headers: {
      "X-AI-Via": decision.target === "local" && !localRuntime ? "cloud" : decision.target,
      "X-AI-Model": decision.model,
      "X-AI-Local-Runtime": localRuntime ? "1" : "0",
      "X-AI-Cloud-Configured": cloudAvailable ? "1" : "0",
    },
  });
}
