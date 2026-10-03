"use client";

/**
 * FAB investigate entry: question → POST /api/ai/chat (taskType=investigate)
 * → agent calls read-only FAB tools → streamed Action Plan.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/lib/i18n/locale-context";
import type { AiStrategy } from "@/lib/ai/types";
import { useAiStream } from "@/lib/ai/use-ai-stream";
import { AiRunResult } from "@/components/ai-run-result";

const STRATEGY_VALUES: AiStrategy[] = ["auto", "only-local", "only-cloud"];

export function FabInvestigatePanel() {
  const { t } = useLocale();
  const copy = t.fabInvestigate;
  const aiCopy = t.aiPage;
  const [question, setQuestion] = useState("");
  const [strategy, setStrategy] = useState<AiStrategy>("auto");
  const { state, start, stop, sendFeedback } = useAiStream(aiCopy);

  function run(nextStrategy: AiStrategy = strategy) {
    const input = question.trim();
    if (!input || state.loading) return;
    void start({ input, taskType: "investigate", strategy: nextStrategy });
  }

  function retryLocal() {
    setStrategy("only-local");
    run("only-local");
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-violet-950">
            {copy.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600">
            {copy.intro}
          </p>
        </div>
        <Link
          href="/ai/runs"
          className="shrink-0 text-xs text-violet-700 hover:underline"
        >
          {copy.viewRuns}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {copy.examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setQuestion(example)}
            disabled={state.loading}
            className="rounded-full bg-white px-3 py-1 text-left text-xs text-violet-900 ring-1 ring-violet-200 hover:bg-violet-50 disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>

      <label htmlFor="fab-question" className="sr-only">
        {copy.inputLabel}
      </label>
      <textarea
        id="fab-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
          }
        }}
        rows={3}
        placeholder={copy.placeholder}
        className="mt-3 w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-950 shadow-sm outline-none ring-violet-400 focus:ring-2"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STRATEGY_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStrategy(value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                strategy === value
                  ? "bg-fuchsia-700 text-white"
                  : "bg-fuchsia-100 text-fuchsia-950 hover:bg-fuchsia-200"
              }`}
            >
              {aiCopy.strategies[value]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {state.loading && (
            <button
              type="button"
              onClick={stop}
              className="rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-sm text-violet-800"
            >
              {aiCopy.stop}
            </button>
          )}
          <button
            type="button"
            onClick={() => run()}
            disabled={state.loading || !question.trim()}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.loading ? copy.running : copy.run}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">{copy.shortcutHint}</p>

      <div className="mt-3">
        <AiRunResult
          state={state}
          copy={aiCopy}
          onRetryLocal={strategy !== "only-local" ? retryLocal : undefined}
          onFeedback={(score) => void sendFeedback(score)}
        />
      </div>
    </section>
  );
}
