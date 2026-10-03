/**
 * Hybrid AI Gateway — POST /api/ai/chat
 *
 * Workflow:
 * 1. Rate-limit the client, parse request (taskType / strategy / input)
 * 2. Input guardrails: sanitize, length/history limits, prompt-injection block,
 *    sensitive data → reroute to local or redact before cloud
 * 3. Detect runtime + route (local Ollama vs cloud)
 * 4. Build prompt messages (or run investigate agent with tools)
 * 5. Stream model output over SSE under a run timeout; fall back local⇄cloud when needed
 * 6. Output guardrails, token usage / cost, then push done
 * 7. Record the run (route, fallback, latency, tools, guardrails, tokens, cost) for /ai/runs
 */
import { randomUUID } from "crypto";
import { streamCloudChat } from "@/lib/ai/cloud";
import {
  shouldFallbackToCloud,
  shouldFallbackToLocal,
  toProviderError,
  type AiProviderError,
} from "@/lib/ai/errors";
import {
  describeFindings,
  redactSensitive,
  runInputGuards,
} from "@/lib/ai/guardrails/input";
import { checkOutputSecrets } from "@/lib/ai/guardrails/output";
import {
  checkRateLimit,
  clientKeyFromRequest,
  RUN_TIMEOUT_MS,
} from "@/lib/ai/guardrails/resource";
import { streamOllamaChat } from "@/lib/ai/ollama";
import { UsageMeter } from "@/lib/ai/pricing";
import { buildMessages } from "@/lib/ai/prompts";
import {
  getCloudModel,
  getLocalModel,
  isCloudConfigured,
  isLocalAiRuntime,
  resolveRoute,
} from "@/lib/ai/router";
import type { AiRunGuardrail, AiRunStatus } from "@/lib/ai/runs";
import { createSseResponse, sseEncode } from "@/lib/ai/sse";
import type {
  AiRouteTarget,
  AiStrategy,
  AiTaskType,
  ChatMessage,
  GuardrailHit,
  StreamEvent,
  TokenUsage,
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

const CLOUD_FALLBACK_LABEL: Partial<Record<string, string>> = {
  quota_exhausted: "云端额度不足",
  rate_limited: "云端限流",
  provider_unavailable: "云端服务暂时不可用",
  network: "无法连接云端",
};

type ParsedBody = {
  input: string;
  taskType: AiTaskType;
  strategy: AiStrategy;
  /** Raw; validated by the input guardrails. */
  messages: unknown;
};

/** Step 1 — Validate and normalize the JSON body from the client */
function parseBody(raw: unknown): ParsedBody | null {
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
    messages: body.messages,
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

function guardrailEvent(hit: GuardrailHit): StreamEvent {
  return { type: "guardrail", ...hit };
}

/** Step 5a — Call local Ollama or cloud API based on the route; yield tokens */
async function* runModel(options: {
  target: "local" | "cloud";
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onUsage: (usage: TokenUsage) => void;
}): AsyncGenerator<string> {
  if (options.target === "cloud") {
    yield* streamCloudChat(options);
    return;
  }
  yield* streamOllamaChat(options);
}

/** Lazy so plain chat never loads node:sqlite (FAB tools) unless the agent runs. */
async function* runInvestigateAgent(
  options: Parameters<typeof import("@/lib/ai/agent").runInvestigateAgent>[0],
): AsyncGenerator<StreamEvent> {
  const agent = await import("@/lib/ai/agent");
  yield* agent.runInvestigateAgent(options);
}

export async function POST(request: Request) {
  const rate = checkRateLimit(clientKeyFromRequest(request));
  if (!rate.ok) {
    return Response.json(
      {
        error: `请求过于频繁（每分钟最多 ${rate.limit} 次），请 ${rate.retryAfterSec} 秒后再试`,
        code: "gateway_rate_limited",
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

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

  const { taskType, strategy } = body;

  // Step 2 — Input guardrails
  const guard = runInputGuards({
    input: body.input,
    history: body.messages,
    taskType,
  });
  const input = guard.input;
  if (!input) {
    return Response.json({ error: "input 不能为空" }, { status: 400 });
  }

  const sensitive = guard.sensitive;
  const cloudInput = sensitive.length > 0 ? redactSensitive(input) : input;
  const cloudHistory =
    sensitive.length > 0
      ? guard.history.map((m) => ({ ...m, content: redactSensitive(m.content) }))
      : guard.history;
  /** Raw text stays on the machine; anything bound for cloud is redacted. */
  const inputFor = (target: AiRouteTarget) =>
    target === "cloud" ? cloudInput : input;
  const messagesFor = (target: AiRouteTarget) =>
    target === "cloud"
      ? buildMessages(taskType, cloudInput, cloudHistory)
      : buildMessages(taskType, input, guard.history);

  // Step 3 — Route
  const cloudAvailable = isCloudConfigured();
  const localRuntime = isLocalAiRuntime();
  const decision = resolveRoute({
    taskType,
    strategy,
    inputLength: input.length,
    cloudAvailable,
    localRuntime,
  });

  const useAgent = taskType === "investigate";
  const runId = randomUUID();
  const startedAt = Date.now();
  const runSignal =
    RUN_TIMEOUT_MS > 0
      ? AbortSignal.any([request.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)])
      : request.signal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let firstDeltaAt: number | null = null;
      let outputChars = 0;
      let outputText = "";
      let toolCalls = 0;
      let lastErrorCode: string | null = null;
      let fellBack = false;
      let blocked = false;
      let timeoutReported = false;
      let redactNoticeSent = false;
      const guardrails: AiRunGuardrail[] = [];
      const meter = new UsageMeter();

      const push = (event: StreamEvent) => {
        if (event.type === "delta") {
          firstDeltaAt ??= Date.now();
          outputChars += event.text.length;
          outputText += event.text;
        } else if (event.type === "tool_call") {
          toolCalls += 1;
        } else if (event.type === "error") {
          lastErrorCode = event.code ?? "unknown";
        } else if (event.type === "guardrail") {
          guardrails.push({
            stage: event.stage,
            rule: event.rule,
            action: event.action,
          });
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
        const status: AiRunStatus = blocked
          ? "blocked"
          : request.signal.aborted
            ? "aborted"
            : lastErrorCode === "timeout"
              ? "error"
              : outputChars > 0
                ? "ok"
                : "error";
        const usage = meter.summary();
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
            inputChars: input.length,
            outputChars,
            toolCalls,
            guardrails,
            usage,
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

      /** Step 6 — Output guardrails, usage, then done. */
      const pushDone = () => {
        if (!blocked) {
          for (const hit of checkOutputSecrets(outputText)) {
            push(guardrailEvent(hit));
          }
        }
        const usage = meter.summary();
        if (usage) push({ type: "usage", ...usage });
        push({ type: "done" });
      };

      const reportTimeout = () => {
        if (timeoutReported) return;
        timeoutReported = true;
        push(
          guardrailEvent({
            stage: "resource",
            rule: "run_timeout",
            action: "block",
            message: `运行超过 ${Math.round(RUN_TIMEOUT_MS / 1000)} 秒上限，已停止`,
          }),
        );
      };

      const noteCloudRedaction = () => {
        if (sensitive.length === 0 || redactNoticeSent) return;
        redactNoticeSent = true;
        push(
          guardrailEvent({
            stage: "input",
            rule: "sensitive_redact",
            action: "redact",
            message: "检测到敏感信息，发送到云端前已脱敏",
            detail: describeFindings(sensitive),
          }),
        );
      };

      const handleRunError = (providerErr: AiProviderError) => {
        if (providerErr.code === "timeout") reportTimeout();
        if (providerErr.code !== "aborted") push(errorEvent(providerErr));
      };

      async function runOn(target: AiRouteTarget, runModelName: string) {
        if (target === "cloud") noteCloudRedaction();
        const onUsage = (usage: TokenUsage) => meter.add(target, usage);
        if (useAgent) {
          for await (const event of runInvestigateAgent({
            target,
            model: runModelName,
            userInput: inputFor(target),
            signal: runSignal,
            onUsage,
          })) {
            if (runSignal.aborted) break;
            push(event);
          }
        } else {
          for await (const text of runModel({
            target,
            model: runModelName,
            messages: messagesFor(target),
            signal: runSignal,
            onUsage,
          })) {
            if (runSignal.aborted) break;
            push({ type: "delta", text });
          }
        }
      }

      push({ type: "run", id: runId });
      for (const hit of guard.hits) push(guardrailEvent(hit));

      if (guard.blocked) {
        const { hint, ...hit } = guard.blocked;
        blocked = true;
        push(guardrailEvent(hit));
        push({
          type: "error",
          message: hit.message,
          code: "guardrail_blocked",
          hint,
          retryable: false,
        });
        pushDone();
        await finish();
        return;
      }

      push({ type: "meta", via, model, reason });

      if (!localRuntime && !cloudAvailable) {
        push({
          type: "error",
          message: "线上环境未配置云端 API Key",
          code: "auth",
          hint: "请在 Vercel → Project → Settings → Environment Variables 添加 OPENAI_API_KEY、OPENAI_BASE_URL、CLOUD_MODEL（与本地 .env.local 相同）。",
          retryable: false,
        });
        pushDone();
        await finish();
        return;
      }

      if (!localRuntime && via === "local") {
        via = "cloud";
        model = getCloudModel();
        reason = "线上环境已强制改走云端";
        push({ type: "meta", via, model, reason });
      }

      // Sensitive data under auto stays local when a local model exists.
      if (sensitive.length > 0 && via === "cloud" && localRuntime && strategy === "auto") {
        via = "local";
        model = getLocalModel();
        reason = "检测到敏感信息，已改走本地（数据不出本机）";
        push(
          guardrailEvent({
            stage: "input",
            rule: "sensitive_reroute",
            action: "reroute",
            message: "检测到敏感信息，已改走本地模型，数据不出本机",
            detail: describeFindings(sensitive),
          }),
        );
        push({ type: "meta", via, model, reason });
      }
      initialTarget = via;

      try {
        try {
          await runOn(via, model);
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
            await runOn("cloud", cloudModel);
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
            reason = `${CLOUD_FALLBACK_LABEL[providerErr.code] ?? "云端不可用"}，已自动降级本地`;
            push({ type: "meta", via, model, reason });
            await runOn("local", localModel);
          } else {
            handleRunError(providerErr);
          }
        }

        if (!request.signal.aborted && runSignal.aborted && !timeoutReported) {
          reportTimeout();
          push({
            type: "error",
            message: "生成超时，已停止",
            code: "timeout",
            hint: "可以缩短输入后重试，或换一侧模型。",
            retryable: true,
          });
        }
        pushDone();
      } catch (err) {
        handleRunError(toProviderError(err, via));
        pushDone();
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
