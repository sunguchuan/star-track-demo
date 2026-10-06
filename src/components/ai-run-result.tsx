"use client";

import { ActionPlanCard } from "@/components/action-plan-card";
import { formatTokens, formatUsd } from "@/lib/ai/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { GuardrailAction, RunUsage } from "@/lib/ai/types";
import { RETRY_LOCAL_CODES, type AiStreamState } from "@/lib/ai/use-ai-stream";
import Link from "next/link";

const GUARDRAIL_TONE: Record<GuardrailAction, string> = {
  block: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  redact: "border-sky-200 bg-sky-50 text-sky-900",
  reroute: "border-emerald-200 bg-emerald-50 text-emerald-900",
  trim: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

type Props = {
  state: AiStreamState;
  copy: Dictionary["aiPage"];
  /** Omit to hide the "retry on local" action (e.g. already local-only). */
  onRetryLocal?: () => void;
  /** Re-run without the answer cache; shown on cached answers. */
  onRegenerate?: () => void;
  onFeedback: (score: 1 | -1) => void;
  emptyText?: string;
};

/** Renders one Gateway run: route badge, tool traces, error, streamed output, feedback. */
export function AiRunResult({
  state,
  copy,
  onRetryLocal,
  onRegenerate,
  onFeedback,
  emptyText = "",
}: Props) {
  const {
    meta,
    cache,
    error,
    output,
    plan,
    usage,
    loading,
    toolTraces,
    guardrails,
    runId,
    feedback,
  } = state;
  const awaitingPlan =
    loading &&
    !output &&
    toolTraces.length > 0 &&
    toolTraces.every((trace) => trace.ok != null);

  if (
    !meta &&
    !error &&
    !output &&
    !loading &&
    toolTraces.length === 0 &&
    guardrails.length === 0
  ) {
    return null;
  }

  return (
    <section className="rounded-xl border border-violet-100 bg-white/80 p-4">
      {meta && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              meta.via === "local"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-sky-100 text-sky-800"
            }`}
          >
            via: {meta.via === "local" ? copy.viaLocal : copy.viaCloud}
          </span>
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
            {meta.model}
          </span>
          <span className="text-zinc-500">{meta.reason}</span>
        </div>
      )}

      {cache && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-900">
          <span className="font-semibold">{copy.cache.badge}</span>
          <span>
            {cache.similarity == null
              ? copy.cache.exact
              : `${copy.cache.similarity} ${(cache.similarity * 100).toFixed(1)}%`}
          </span>
          <span className="tabular-nums">
            {copy.cache.saved} {(cache.savedMs / 1000).toFixed(1)}s
            {cache.savedUsd > 0 && ` · ${formatUsd(cache.savedUsd)}`}
          </span>
          <Link href={`/ai/runs/${cache.sourceRunId}`} className="underline-offset-2 hover:underline">
            {copy.cache.source} · {new Date(cache.createdAt).toLocaleString()}
          </Link>
          {onRegenerate && !loading && (
            <button
              type="button"
              onClick={onRegenerate}
              title={copy.cache.regenerateHint}
              className="ml-auto rounded-md bg-white px-2.5 py-1 font-medium text-teal-800 ring-1 ring-teal-200 hover:bg-teal-100"
            >
              {copy.cache.regenerate}
            </button>
          )}
        </div>
      )}

      {guardrails.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-xs font-medium text-zinc-600">{copy.guardrails}</p>
          <ul className="space-y-1.5">
            {guardrails.map((hit, index) => (
              <li
                key={`${hit.rule}-${index}`}
                className={`rounded-lg border px-3 py-1.5 text-xs ${GUARDRAIL_TONE[hit.action]}`}
              >
                <span className="font-medium">
                  [{copy.guardrailStages[hit.stage]} ·{" "}
                  {copy.guardrailActions[hit.action]}]
                </span>{" "}
                {hit.message}
                {hit.detail && (
                  <span className="mt-0.5 block break-all font-mono text-[11px] opacity-80">
                    {hit.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toolTraces.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-medium text-zinc-600">{copy.toolCalls}</p>
          <ul className="space-y-2">
            {toolTraces.map((trace) => (
              <li
                key={trace.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium text-violet-900">
                    {trace.name}
                  </span>
                  {trace.ok != null && (
                    <span
                      className={trace.ok ? "text-emerald-700" : "text-red-600"}
                    >
                      {trace.ok ? copy.toolOk : copy.toolFail}
                    </span>
                  )}
                </div>
                {trace.arguments && trace.arguments !== "{}" && (
                  <p className="mt-1 font-mono text-[11px] text-zinc-500">
                    {trace.arguments}
                  </p>
                )}
                {trace.sources ? (
                  trace.sources.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {trace.sources.map((source) => (
                        <li key={`${source.docId}#${source.heading}`} className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[11px] text-violet-900">
                            {source.docId}
                          </span>
                          <span className="text-zinc-600">{source.heading}</span>
                          {source.relevance != null && (
                            <span className="text-[10px] text-zinc-400">
                              {copy.sourceRelevance} {source.relevance}/3
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-400">{source.matchedBy.join(" + ")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11px] text-zinc-500">{copy.noSources}</p>
                  )
                ) : (
                  trace.preview && (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-600">
                      {trace.preview}
                    </pre>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mb-2 space-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-medium">{error.message}</p>
          {error.hint && (
            <p className="text-xs text-red-600/90">{error.hint}</p>
          )}
          {onRetryLocal &&
            error.code &&
            RETRY_LOCAL_CODES.has(error.code) &&
            !loading && (
              <button
                type="button"
                onClick={onRetryLocal}
                className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-200 hover:bg-violet-50"
              >
                {copy.retryLocal}
              </button>
            )}
        </div>
      )}

      {plan ? (
        <ActionPlanCard value={plan} copy={copy} />
      ) : (
        <div className="min-h-24 whitespace-pre-wrap text-sm leading-relaxed text-violet-950">
          {output || (awaitingPlan ? copy.plan.pending : loading ? "…" : emptyText)}
          {loading && (
            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-violet-500 align-middle" />
          )}
        </div>
      )}

      {!loading && usage && <UsageLine usage={usage} copy={copy} />}

      {!loading && runId && output && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-violet-100 pt-3 text-xs text-zinc-500">
          {feedback === "up" || feedback === "down" ? (
            <span>{copy.feedbackSaved}</span>
          ) : (
            <>
              <span>{copy.feedbackPrompt}</span>
              <button
                type="button"
                onClick={() => onFeedback(1)}
                disabled={feedback === "saving"}
                className="rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
              >
                {copy.feedbackUp}
              </button>
              <button
                type="button"
                onClick={() => onFeedback(-1)}
                disabled={feedback === "saving"}
                title={cache ? copy.cache.feedbackEvicts : undefined}
                className="rounded-md bg-zinc-50 px-2.5 py-1 font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 disabled:opacity-50"
              >
                {copy.feedbackDown}
              </button>
              {feedback === "failed" && (
                <span className="text-red-600">{copy.feedbackFailed}</span>
              )}
            </>
          )}
          <Link
            href={`/ai/runs/${runId}`}
            className="ml-auto font-medium text-violet-700 hover:underline"
          >
            {copy.viewTrace}
          </Link>
        </div>
      )}
    </section>
  );
}

function UsageLine({ usage, copy }: { usage: RunUsage; copy: Dictionary["aiPage"] }) {
  const parts = [
    `${copy.usage.tokens} ${formatTokens(usage.promptTokens)} ${copy.usage.in} / ${formatTokens(usage.completionTokens)} ${copy.usage.out}`,
    `${usage.calls} ${copy.usage.calls}`,
  ];
  if (usage.costUsd > 0) parts.push(`${copy.usage.cost} ${formatUsd(usage.costUsd)}`);
  if (usage.savedUsd > 0) parts.push(`${copy.usage.saved} ${formatUsd(usage.savedUsd)}`);
  return (
    <p className="mt-2 text-[11px] tabular-nums text-zinc-500" title={copy.usage.note}>
      {parts.join(" · ")}
    </p>
  );
}
