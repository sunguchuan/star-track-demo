"use client";

/**
 * Client side of the Gateway protocol: POST /api/ai/chat, consume SSE
 * (run → meta → tool_call/tool_result* → plan? → delta* → error? → usage? → done,
 * with guardrail events anywhere before done) and expose the run as React state.
 * Shared by the notes panel and the FAB investigate panel. Protocol: docs/ai-gateway.md §8.
 */
import { useCallback, useRef, useState } from "react";
import type { ActionPlan } from "@/lib/ai/action-plan";
import type {
  AiStrategy,
  AiTaskType,
  GuardrailHit,
  RunUsage,
  StreamEvent,
} from "@/lib/ai/types";

export type AiRunMeta = {
  via: "local" | "cloud";
  model: string;
  reason: string;
};

export type AiRunError = {
  message: string;
  hint?: string;
  code?: string;
  retryable?: boolean;
};

export type AiToolTrace = {
  id: string;
  name: string;
  arguments: string;
  ok?: boolean;
  preview?: string;
};

export type AiFeedbackState = "idle" | "saving" | "up" | "down" | "failed";

export type AiStreamCopy = {
  requestFailed: string;
  noStream: string;
  networkHint: string;
  retryHint: string;
};

export type AiStreamRequest = {
  input: string;
  taskType: AiTaskType;
  strategy: AiStrategy;
};

export type AiPlanState = {
  plan: ActionPlan;
  ungroundedRefs: string[];
};

export type AiStreamState = {
  output: string;
  /** Structured Action Plan (investigate); `output` then holds its Markdown twin. */
  plan: AiPlanState | null;
  usage: RunUsage | null;
  meta: AiRunMeta | null;
  error: AiRunError | null;
  toolTraces: AiToolTrace[];
  guardrails: GuardrailHit[];
  runId: string | null;
  feedback: AiFeedbackState;
  loading: boolean;
};

/** Error codes where retrying on the local model is a sensible manual action. */
export const RETRY_LOCAL_CODES = new Set([
  "quota_exhausted",
  "rate_limited",
  "provider_unavailable",
  "auth",
  "model_unavailable",
]);

export function useAiStream(copy: AiStreamCopy) {
  const [output, setOutput] = useState("");
  const [plan, setPlan] = useState<AiPlanState | null>(null);
  const [usage, setUsage] = useState<RunUsage | null>(null);
  const [meta, setMeta] = useState<AiRunMeta | null>(null);
  const [error, setError] = useState<AiRunError | null>(null);
  const [toolTraces, setToolTraces] = useState<AiToolTrace[]>([]);
  const [guardrails, setGuardrails] = useState<GuardrailHit[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AiFeedbackState>("idle");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback((nextOutput = "") => {
    setOutput(nextOutput);
    setPlan(null);
    setUsage(null);
    setMeta(null);
    setError(null);
    setToolTraces([]);
    setGuardrails([]);
    setRunId(null);
    setFeedback("idle");
  }, []);

  /** Resolves with the assembled output (possibly partial if stopped). */
  async function start(request: AiStreamRequest): Promise<string> {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    reset();
    setLoading(true);

    let assembled = "";

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: ac.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `${copy.requestFailed} (${res.status})`);
      }

      if (!res.body) {
        throw new Error(copy.noStream);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "run") {
            setRunId(event.id);
          } else if (event.type === "guardrail") {
            const { stage, rule, action, message, detail } = event;
            setGuardrails((prev) => [
              ...prev,
              { stage, rule, action, message, detail },
            ]);
          } else if (event.type === "meta") {
            setMeta({
              via: event.via,
              model: event.model,
              reason: event.reason,
            });
          } else if (event.type === "tool_call") {
            setToolTraces((prev) => [
              ...prev.filter((t) => t.id !== event.id),
              { id: event.id, name: event.name, arguments: event.arguments },
            ]);
          } else if (event.type === "tool_result") {
            setToolTraces((prev) =>
              prev.map((t) =>
                t.id === event.id
                  ? { ...t, ok: event.ok, preview: event.preview }
                  : t,
              ),
            );
          } else if (event.type === "plan") {
            setPlan({ plan: event.plan, ungroundedRefs: event.ungroundedRefs });
          } else if (event.type === "usage") {
            setUsage({
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              calls: event.calls,
              costUsd: event.costUsd,
              savedUsd: event.savedUsd,
            });
          } else if (event.type === "delta") {
            if (assembled.length === 0) {
              setError(null);
            }
            assembled += event.text;
            setOutput(assembled);
          } else if (event.type === "error") {
            setError({
              message: event.message,
              hint: event.hint,
              code: event.code,
              retryable: event.retryable,
            });
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return assembled;
      }
      const message = err instanceof Error ? err.message : copy.requestFailed;
      setError({
        message,
        hint: /fetch|network|Failed to fetch/i.test(message)
          ? copy.networkHint
          : copy.retryHint,
        retryable: true,
      });
    } finally {
      if (abortRef.current === ac) {
        setLoading(false);
      }
    }

    return assembled;
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  async function sendFeedback(score: 1 | -1) {
    if (!runId || feedback === "saving") return;
    setFeedback("saving");
    try {
      const res = await fetch(`/api/ai/runs/${runId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      setFeedback(res.ok ? (score === 1 ? "up" : "down") : "failed");
    } catch {
      setFeedback("failed");
    }
  }

  const state: AiStreamState = {
    output,
    plan,
    usage,
    meta,
    error,
    toolTraces,
    guardrails,
    runId,
    feedback,
    loading,
  };

  return { state, start, stop, reset, sendFeedback };
}
