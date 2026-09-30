/**
 * Hybrid AI Gateway — POST /api/ai/chat
 *
 * Workflow:
 * 1. Parse request (taskType / strategy / input)
 * 2. Detect runtime + route (local Ollama vs cloud)
 * 3. Build prompt messages (or run investigate agent with tools)
 * 4. Stream model output over SSE; fall back local⇄cloud when needed
 * 5. Push run / meta / tool_* / delta / error / done events to the client
 * 6. Record the run (route, fallback, latency, tools) for /ai/runs
 */
import { randomUUID } from "crypto";
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
import type { AiRunStatus } from "@/lib/ai/runs";
import { createSseResponse, sseEncode } from "@/lib/ai/sse";
import type {
  AiRouteTarget,
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
  "investigate",
  "chat",
]);

const STRATEGIES = new Set<AiStrategy>(["auto", "only-local", "only-cloud"]);

/** Step 1 — Validate and normalize the JSON body from the client */
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

/** Step 4a — Call local Ollama or cloud API based on the route; yield tokens */
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

/** Lazy so plain chat never loads node:sqlite (FAB tools) unless the agent runs. */
async function* runInvestigateAgent(
  options: Parameters<typeof import("@/lib/ai/agent").runInvestigateAgent>[0],
): AsyncGenerator<StreamEvent> {
  const agent = await import("@/lib/ai/agent");
  yield* agent.runInvestigateAgent(options);
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
  const useAgent = taskType === "investigate";
  const runId = randomUUID();
  const startedAt = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let firstDeltaAt: number | null = null;
      let outputChars = 0;
      let toolCalls = 0;
      let lastErrorCode: string | null = null;
      let fellBack = false;

      const push = (event: StreamEvent) => {
        if (event.type === "delta") {
          firstDeltaAt ??= Date.now();
          outputChars += event.text.length;
        } else if (event.type === "tool_call") {
          toolCalls += 1;
        } else if (event.type === "error") {
          lastErrorCode = event.code ?? "unknown";
        }
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          // Client disconnected; keep going so the run is still recorded.
        }
      };

      let via = decision.target;
      let model = decision.model;
      let reason = decision.reason;
      let initialTarget: AiRouteTarget = via;

      const finish = async () => {
        const status: AiRunStatus = request.signal.aborted
          ? "aborted"
          : outputChars > 0
            ? "ok"
            : "error";
        try {
          const { recordRun } = await import("@/lib/ai/runs");
          recordRun({
            id: runId,
            createdAt: new Date(startedAt).toISOString(),
            taskType,
            strategy,
            initialTarget,
            via,
            model,
            reason,
            fellBack,
            status,
            errorCode: lastErrorCode,
            ttftMs: firstDeltaAt == null ? null : firstDeltaAt - startedAt,
            totalMs: Date.now() - startedAt,
            inputChars: body.input.trim().length,
            outputChars,
            toolCalls,
          });
        } catch (err) {
          console.error("[ai/chat] failed to record run", err);
        }
        try {
          controller.close();
        } catch {
          // already closed by client cancel
        }
      };

      push({ type: "run", id: runId });
      push({ type: "meta", via, model, reason });

      if (!localRuntime && !cloudAvailable) {
        push({
          type: "error",
          message: "线上环境未配置云端 API Key",
          code: "auth",
          hint: "请在 Vercel → Project → Settings → Environment Variables 添加 OPENAI_API_KEY、OPENAI_BASE_URL、CLOUD_MODEL（与本地 .env.local 相同）。",
          retryable: false,
        });
        push({ type: "done" });
        await finish();
        return;
      }

      if (!localRuntime && via === "local") {
        via = "cloud";
        model = getCloudModel();
        reason = "线上环境已强制改走云端";
        push({ type: "meta", via, model, reason });
      }
      initialTarget = via;

      try {
        try {
          if (useAgent) {
            for await (const event of runInvestigateAgent({
              target: via,
              model,
              userInput: body.input.trim(),
              signal: request.signal,
            })) {
              if (request.signal.aborted) break;
              push(event);
            }
          } else {
            for await (const text of runModel({
              target: via,
              model,
              messages,
              signal: request.signal,
            })) {
              if (request.signal.aborted) break;
              push({ type: "delta", text });
            }
          }
        } catch (err) {
          const providerErr = toProviderError(err, via);

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

            fellBack = true;
            via = "cloud";
            model = cloudModel;
            reason = "本地不可用，已自动改走云端";
            push({ type: "meta", via, model, reason });

            if (useAgent) {
              for await (const event of runInvestigateAgent({
                target: "cloud",
                model: cloudModel,
                userInput: body.input.trim(),
                signal: request.signal,
              })) {
                if (request.signal.aborted) break;
                push(event);
              }
            } else {
              for await (const text of runModel({
                target: "cloud",
                model: cloudModel,
                messages,
                signal: request.signal,
              })) {
                if (request.signal.aborted) break;
                push({ type: "delta", text });
              }
            }
          } else if (
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

            fellBack = true;
            via = "local";
            model = localModel;
            reason = `云端${providerErr.code === "quota_exhausted" ? "额度不足" : "限流"}，已自动降级本地`;
            push({ type: "meta", via, model, reason });

            if (useAgent) {
              for await (const event of runInvestigateAgent({
                target: "local",
                model: localModel,
                userInput: body.input.trim(),
                signal: request.signal,
              })) {
                if (request.signal.aborted) break;
                push(event);
              }
            } else {
              for await (const text of runModel({
                target: "local",
                model: localModel,
                messages,
                signal: request.signal,
              })) {
                if (request.signal.aborted) break;
                push({ type: "delta", text });
              }
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
        await finish();
      }
    },
  });

  return createSseResponse(stream, {
    headers: {
      "X-AI-Via":
        decision.target === "local" && !localRuntime
          ? "cloud"
          : decision.target,
      "X-AI-Model": decision.model,
      "X-AI-Local-Runtime": localRuntime ? "1" : "0",
      "X-AI-Cloud-Configured": cloudAvailable ? "1" : "0",
      "X-AI-Agent": useAgent ? "1" : "0",
      "X-AI-Run-Id": runId,
    },
  });
}
