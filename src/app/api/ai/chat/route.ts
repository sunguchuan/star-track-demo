/**
 * Hybrid AI Gateway — POST /api/ai/chat
 *
 * Workflow:
 * 1. Rate-limit the client, parse request (taskType / strategy / input)
 * 2. Input guardrails: sanitize, length/history limits, prompt-injection block,
 *    sensitive data → reroute to local or redact before cloud
 * 3. Detect runtime + route (local Ollama vs cloud)
 * 4. Answer cache: replay an exact / semantically equivalent earlier answer when allowed
 * 5. Build prompt messages (or run investigate agent with tools); stream model output over
 *    SSE under a run timeout; fall back local⇄cloud when needed
 * 6. Output guardrails, token usage / cost, then push done
 * 7. Record the run (route, fallback, latency, tools, guardrails, tokens, cost, cache) and
 *    its span tree for /ai/runs; store clean answers in the cache; export the trace to
 *    Langfuse after the response when configured
 */
import { randomUUID } from "crypto";
import { after } from "next/server";
import {
  buildCacheContext,
  cacheModeFor,
  storeSkipReason,
  type CacheContext,
} from "@/lib/ai/cache-keys";
import { streamCloudChat } from "@/lib/ai/cloud";
import { assessDifficulty, type ModelTier } from "@/lib/ai/difficulty";
import type { Embedding } from "@/lib/ai/embeddings";
import {
  shouldDowngradeTier,
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
import { isLangfuseEnabled, type TraceExportMeta } from "@/lib/ai/langfuse-config";
import { streamOllamaChat } from "@/lib/ai/ollama";
import { UsageMeter } from "@/lib/ai/pricing";
import { buildMessages } from "@/lib/ai/prompts";
import {
  getCloudModel,
  getLocalModel,
  getStrongCloudModel,
  isCloudConfigured,
  isLocalAiRuntime,
  isStrongModelCoolingDown,
  noteStrongModelFailure,
  resolveRoute,
} from "@/lib/ai/router";
import type { AiRunCache, AiRunGuardrail, AiRunStatus } from "@/lib/ai/runs";
import type { CachedPlan } from "@/lib/ai/semantic-cache";
import { createSseResponse, sseEncode } from "@/lib/ai/sse";
import { recordGuardrails, RunTrace, traceStream } from "@/lib/ai/trace";
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
  /** false = regenerate: skip the cache lookup (the fresh answer still replaces the entry). */
  cache: boolean;
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
    cache: body.cache !== false,
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

/** Investigate answers depend on the FAB tables and the knowledge base; other tasks only on their input. */
async function cacheDataVersion(taskType: AiTaskType): Promise<string> {
  if (taskType !== "investigate") return "-";
  const { getFabDataVersion } = await import("@/lib/fab/queries");
  const { isKnowledgeEnabled } = await import("@/lib/ai/tools/knowledge");
  if (!isKnowledgeEnabled()) return getFabDataVersion();
  const { getCorpusVersion } = await import("@/lib/rag/retrieve");
  return `${getFabDataVersion()}+kb:${getCorpusVersion()}`;
}

function cacheReason(hit: { mode: string; similarity: number | null }): string {
  return hit.similarity == null
    ? "相同输入已有结果，直接返回缓存"
    : `相似问题已有答案（相似度 ${(hit.similarity * 100).toFixed(1)}%），直接返回缓存`;
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
  const useAgent = taskType === "investigate";
  const runId = randomUUID();
  const trace = new RunTrace(runId);
  const root = trace.start("ai.chat", useAgent ? "agent" : "span", {
    input: body.input,
    metadata: { taskType, strategy },
  });

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
  recordGuardrails(
    root,
    "guardrails.input",
    guard.blocked ? [...guard.hits, guard.blocked] : guard.hits,
    { sensitive: describeFindings(guard.sensitive) || null, historyMessages: guard.history.length },
  );

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

  // Step 3 — Route (local vs cloud), plus the difficulty that picks the cloud tier
  const cloudAvailable = isCloudConfigured();
  const localRuntime = isLocalAiRuntime();
  const decision = resolveRoute({
    taskType,
    strategy,
    inputLength: input.length,
    cloudAvailable,
    localRuntime,
  });
  const difficulty = assessDifficulty({ taskType, input, history: guard.history });
  const configuredStrong = getStrongCloudModel();
  const strongCoolingDown = configuredStrong != null && isStrongModelCoolingDown();
  const strongModel = strongCoolingDown ? null : configuredStrong;
  /** Complex requests get the strong tier on cloud when one is configured. */
  const cloudModelFor = () =>
    difficulty.level === "complex" && strongModel ? strongModel : getCloudModel();
  root
    .child("route", "span", {
      metadata: {
        strategy,
        inputChars: input.length,
        localRuntime,
        cloudAvailable,
        difficulty,
        strongModel: configuredStrong,
        strongCoolingDown,
      },
    })
    .end({ output: decision });

  const startedAt = trace.spans[0].startedAt;
  let resolveTraceDone: (meta: TraceExportMeta) => void = () => {};
  const traceDone = new Promise<TraceExportMeta>((resolve) => {
    resolveTraceDone = resolve;
  });
  if (isLangfuseEnabled()) {
    after(async () => {
      const meta = await traceDone;
      const { exportRunTrace } = await import("@/lib/ai/langfuse");
      await exportRunTrace(trace, meta);
    });
  }
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
      let lastPlan: CachedPlan | null = null;
      let cacheContext: CacheContext | null = null;
      let cacheEmbedding: Embedding | null = null;
      let cacheHit: AiRunCache | null = null;
      let escalated = false;
      const guardrails: AiRunGuardrail[] = [];
      const meter = new UsageMeter();

      const push = (event: StreamEvent) => {
        if (event.type === "meta") {
          // The agent reports plan-model changes (strong-tier downgrade / escalation).
          model = event.model;
          reason = event.reason;
          if (event.escalated) escalated = true;
        } else if (event.type === "plan") {
          lastPlan = { plan: event.plan, ungroundedRefs: event.ungroundedRefs };
        } else if (event.type === "delta") {
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
        const totalMs = Date.now() - startedAt;
        const tier: ModelTier | null =
          via === "cloud" && !cacheHit && !blocked
            ? model === strongModel
              ? "strong"
              : "standard"
            : null;
        if (cacheContext && !cacheHit) {
          const skip = storeSkipReason({
            status,
            outputChars,
            errorCode: lastErrorCode,
            sensitive: sensitive.length > 0,
            guardrailStages: guardrails.map((g) => g.stage),
            ungroundedRefs: (lastPlan as CachedPlan | null)?.ungroundedRefs.length ?? 0,
          });
          if (skip) {
            root.child("cache.store", "span").end({ metadata: { skipped: skip } });
          } else {
            try {
              const { rememberAnswer } = await import("@/lib/ai/semantic-cache");
              rememberAnswer({
                context: cacheContext,
                embedding: cacheEmbedding,
                input,
                target: via,
                model,
                output: outputText,
                plan: lastPlan,
                sourceRunId: runId,
                sourceMs: totalMs,
                sourceCostUsd: usage?.costUsd ?? 0,
                replaceSimilar: !body.cache,
                parent: root,
              });
            } catch (err) {
              console.error("[ai/chat] failed to cache answer", err);
            }
          }
        }
        const tags: string[] = [taskType, via, status];
        if (fellBack) tags.push("fallback");
        if (guardrails.length > 0) tags.push("guardrail");
        if (cacheHit) tags.push(`cache:${cacheHit.mode}`);
        if (tier) tags.push(`tier:${tier}`);
        if (escalated) tags.push("escalated");
        root.update({ target: via, model });
        root.end({
          output: outputText,
          status: status === "ok" ? "ok" : status === "error" ? "error" : "warning",
          statusMessage: status === "ok" ? null : (lastErrorCode ?? status),
          metadata: {
            status,
            initialTarget,
            via,
            model,
            reason,
            fellBack,
            errorCode: lastErrorCode,
            toolCalls,
            usage,
            cache: cacheHit,
            difficulty: difficulty.level,
            tier,
            escalated,
          },
        });
        trace.close();
        resolveTraceDone({ runId, taskType, status, tags });
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
            totalMs,
            inputChars: input.length,
            outputChars,
            toolCalls,
            guardrails,
            usage,
            cache: cacheHit,
            difficulty: difficulty.level,
            tier,
            escalated,
            spans: trace.spans,
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
          const hits = checkOutputSecrets(outputText);
          recordGuardrails(root, "guardrails.output", hits, { outputChars });
          for (const hit of hits) push(guardrailEvent(hit));
        }
        const usage = meter.summary();
        if (usage) push({ type: "usage", ...usage });
        push({ type: "done" });
      };

      const reportTimeout = () => {
        if (timeoutReported) return;
        timeoutReported = true;
        const hit: GuardrailHit = {
          stage: "resource",
          rule: "run_timeout",
          action: "block",
          message: `运行超过 ${Math.round(RUN_TIMEOUT_MS / 1000)} 秒上限，已停止`,
        };
        recordGuardrails(root, "guardrails.resource", [hit], { timeoutMs: RUN_TIMEOUT_MS });
        push(guardrailEvent(hit));
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
        const attempt = root.child(`attempt.${target}`, "span", {
          target,
          model: runModelName,
          metadata: { fallback: fellBack, redacted: target === "cloud" && sensitive.length > 0 },
        });
        if (target === "cloud") noteCloudRedaction();
        const onUsage = (usage: TokenUsage, usedModel?: string | null) =>
          meter.add(target, usage, usedModel);
        try {
          if (useAgent) {
            // Strong tier writes the Action Plan only; tool selection stays on the fast model.
            const strongRun = target === "cloud" && strongModel != null && runModelName === strongModel;
            for await (const event of runInvestigateAgent({
              target,
              model: strongRun ? getCloudModel() : runModelName,
              planModel: strongRun ? strongModel : null,
              escalationModel: target === "cloud" && !strongRun ? strongModel : null,
              userInput: inputFor(target),
              signal: runSignal,
              onUsage,
              span: attempt,
            })) {
              if (runSignal.aborted) break;
              push(event);
            }
          } else {
            const messages = messagesFor(target);
            const generation = attempt.child("llm.chat", "generation", {
              target,
              model: runModelName,
              input: messages.at(-1)?.content ?? "",
              metadata: { taskType, messages: messages.length },
            });
            for await (const text of traceStream(
              generation,
              runModel({
                target,
                model: runModelName,
                messages,
                signal: runSignal,
                onUsage: generation.usageSink(onUsage),
              }),
            )) {
              if (runSignal.aborted) break;
              push({ type: "delta", text });
            }
          }
          attempt.end(
            runSignal.aborted
              ? { status: "warning", statusMessage: request.signal.aborted ? "aborted by client" : "run timeout" }
              : {},
          );
        } catch (err) {
          attempt.fail(toProviderError(err, target));
          throw err;
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
        const hit: GuardrailHit = {
          stage: "input",
          rule: "sensitive_reroute",
          action: "reroute",
          message: "检测到敏感信息，已改走本地模型，数据不出本机",
          detail: describeFindings(sensitive),
        };
        recordGuardrails(root, "guardrails.reroute", [hit]);
        push(guardrailEvent(hit));
        push({ type: "meta", via, model, reason });
      }

      // Step 4 — Answer cache (never for sensitive input or chat with history).
      const cacheMode = cacheModeFor(taskType, guard.history.length > 0);
      if (cacheMode && sensitive.length === 0) {
        try {
          const cache = await import("@/lib/ai/semantic-cache");
          if (cache.isCacheEnabled()) {
            cacheContext = buildCacheContext({
              mode: cacheMode,
              taskType,
              input,
              history: guard.history,
              strategy,
              dataVersion: await cacheDataVersion(taskType),
            });
            const lookup = await cache.lookupAnswer({
              context: cacheContext,
              input,
              bypass: !body.cache,
              localRuntime,
              cloudAvailable,
              signal: runSignal,
              parent: root,
            });
            cacheEmbedding = lookup.embedding;
            const hit = lookup.hit;
            if (hit && !runSignal.aborted) {
              via = hit.target;
              model = hit.model;
              reason = cacheReason(hit);
              initialTarget = via;
              const savedMs = Math.max(0, hit.sourceMs - (Date.now() - startedAt));
              cacheHit = {
                mode: hit.mode,
                similarity: hit.similarity,
                entryId: hit.id,
                savedMs,
                savedUsd: hit.sourceCostUsd,
              };
              push({ type: "meta", via, model, reason });
              push({
                type: "cache",
                mode: hit.mode,
                similarity: hit.similarity,
                entryId: hit.id,
                sourceRunId: hit.sourceRunId,
                createdAt: hit.createdAt,
                savedMs,
                savedUsd: hit.sourceCostUsd,
              });
              if (hit.plan) push({ type: "plan", ...hit.plan });
              push({ type: "delta", text: hit.output });
              pushDone();
              await finish();
              return;
            }
          }
        } catch (err) {
          console.error("[ai/chat] cache lookup failed", err);
        }
      }
      initialTarget = via;

      if (via === "cloud" && model !== cloudModelFor()) {
        model = cloudModelFor();
        reason = `${reason}；问题较复杂（${difficulty.signals.join(" + ")}），改用强模型`;
        push({ type: "meta", via, model, reason });
      } else if (via === "cloud" && difficulty.level === "complex" && strongCoolingDown) {
        reason = `${reason}；问题较复杂，但强模型刚出现故障（冷却中），仍用标准模型`;
        push({ type: "meta", via, model, reason });
      }

      try {
        let failure: unknown = null;
        try {
          await runOn(via, model);
        } catch (err) {
          failure = err;
        }

        // The agent downgrades its own plan call; plain chat retries the whole call here.
        if (
          failure &&
          !useAgent &&
          via === "cloud" &&
          model === strongModel &&
          outputChars === 0 &&
          !runSignal.aborted &&
          shouldDowngradeTier(failure)
        ) {
          const providerErr = toProviderError(failure, "cloud");
          failure = null;
          noteStrongModelFailure();
          push({
            type: "error",
            message: `强模型${providerErr.message}，正在改用标准模型…`,
            code: providerErr.code,
            hint: providerErr.hint,
            retryable: true,
          });
          model = getCloudModel();
          reason = "强模型不可用，已改用标准云端模型";
          push({ type: "meta", via, model, reason });
          try {
            await runOn("cloud", model);
          } catch (err) {
            failure = err;
          }
        }

        if (failure) {
          const providerErr = toProviderError(failure, via);

          if (
            via === "local" &&
            localRuntime &&
            cloudAvailable &&
            shouldFallbackToCloud(providerErr)
          ) {
            const cloudModel = cloudModelFor();
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
