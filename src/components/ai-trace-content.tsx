"use client";

import { formatTokens, formatUsd } from "@/lib/ai/format";
import type { AiRunRecord } from "@/lib/ai/runs";
import type { SpanKind, SpanStatus, TraceSpan } from "@/lib/ai/trace";
import { buildWaterfall, summarizeTrace, type WaterfallRow } from "@/lib/ai/trace-view";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";
import { useState } from "react";

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const KIND_STYLES: Record<SpanKind, { bar: string; badge: string }> = {
  agent: { bar: "bg-violet-400", badge: "bg-violet-100 text-violet-800" },
  generation: { bar: "bg-sky-400", badge: "bg-sky-100 text-sky-800" },
  embedding: { bar: "bg-indigo-300", badge: "bg-indigo-100 text-indigo-800" },
  retriever: { bar: "bg-teal-400", badge: "bg-teal-100 text-teal-800" },
  tool: { bar: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-800" },
  guardrail: { bar: "bg-amber-400", badge: "bg-amber-100 text-amber-900" },
  span: { bar: "bg-zinc-300", badge: "bg-zinc-100 text-zinc-700" },
};

const STATUS_DOT: Record<SpanStatus, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export function AiTraceContent({
  run,
  spans,
  langfuseEnabled,
  langfuseUrl,
}: {
  run: AiRunRecord;
  spans: TraceSpan[];
  langfuseEnabled: boolean;
  langfuseUrl: string | null;
}) {
  const { t, locale } = useLocale();
  const copy = t.aiTrace;
  const rows = buildWaterfall(spans);
  const summary = summarizeTrace(spans);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-12 pt-6">
      <Link
        href="/ai/runs"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {copy.backToRuns}
      </Link>

      <h1 className="text-2xl font-bold text-violet-950">{copy.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">{copy.intro}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-violet-900">
          {t.aiPage.tasks[run.taskType] ?? run.taskType}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            run.via === "local" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
          }`}
        >
          {run.via === "local" ? t.aiRuns.viaLocal : t.aiRuns.viaCloud}
        </span>
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">{run.model}</span>
        <span className="text-zinc-500">
          <time dateTime={run.createdAt} suppressHydrationWarning>
            {new Date(run.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}
          </time>
        </span>
        <code className="text-[11px] text-zinc-400">{run.id}</code>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        {langfuseUrl ? (
          <a
            href={langfuseUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-violet-700 hover:underline"
          >
            {copy.openInLangfuse}
          </a>
        ) : langfuseEnabled ? (
          copy.langfuseOn
        ) : (
          copy.langfuseOff
        )}
      </p>

      {!summary ? (
        <p className="mt-8 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-10 text-center text-sm text-violet-700/80">
          {copy.noSpans}
        </p>
      ) : (
        <>
          <section className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Stat label={copy.duration} value={formatMs(summary.durationMs)} />
            <Stat label={copy.spans} value={String(summary.spans)} />
            <Stat label={copy.llmCalls} value={String(summary.llmCalls)} />
            <Stat label={copy.toolCalls} value={String(summary.toolCalls)} />
            <Stat
              label={copy.tokens}
              value={formatTokens(summary.promptTokens + summary.completionTokens)}
              hint={`${formatTokens(summary.promptTokens)} / ${formatTokens(summary.completionTokens)}`}
            />
            <Stat label={copy.cost} value={formatUsd(summary.costUsd)} />
          </section>

          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              {(Object.keys(KIND_STYLES) as SpanKind[]).map((kind) => (
                <span key={kind} className={`rounded px-1.5 py-0.5 ${KIND_STYLES[kind].badge}`}>
                  {copy.kinds[kind]}
                </span>
              ))}
              <span className="ml-auto text-zinc-500">{copy.clickHint}</span>
            </div>
            <ul className="overflow-hidden rounded-xl border border-violet-100 bg-white">
              {rows.map((row) => (
                <SpanRow
                  key={row.span.id}
                  row={row}
                  open={openId === row.span.id}
                  onToggle={() => setOpenId(openId === row.span.id ? null : row.span.id)}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function SpanRow({
  row,
  open,
  onToggle,
}: {
  row: WaterfallRow;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const copy = t.aiTrace;
  const { span } = row;
  const style = KIND_STYLES[span.kind];

  return (
    <li className="border-t border-violet-50 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-violet-50/60 ${
          open ? "bg-violet-50/60" : ""
        }`}
      >
        <span
          className="flex w-[45%] min-w-0 shrink-0 items-center gap-1.5"
          style={{ paddingLeft: `${row.depth * 14}px` }}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[span.status]}`} />
          <span className="truncate font-mono text-violet-950" title={span.name}>
            {span.name}
          </span>
          {span.usage && (
            <span className="shrink-0 tabular-nums text-zinc-400">
              {formatTokens(span.usage.promptTokens + span.usage.completionTokens)}
            </span>
          )}
        </span>
        <span className="relative h-4 flex-1">
          <span
            className={`absolute top-0.5 h-3 overflow-hidden rounded-sm ${style.bar} ${
              span.status === "error" ? "ring-2 ring-red-500" : ""
            }`}
            style={{
              left: `${Math.min(row.offsetPct, 99.5)}%`,
              width: `max(${row.widthPct}%, 2px)`,
            }}
          >
            {row.ttftPct != null && (
              <span
                className="absolute inset-y-0 left-0 bg-white/50"
                style={{ width: `${row.ttftPct}%` }}
                title={copy.ttftLegend}
              />
            )}
          </span>
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-zinc-600">
          {formatMs(row.durationMs)}
        </span>
      </button>
      {open && <SpanDetail span={span} />}
    </li>
  );
}

function SpanDetail({ span }: { span: TraceSpan }) {
  const { t } = useLocale();
  const copy = t.aiTrace;
  const facts: [string, string][] = [
    [copy.kind, copy.kinds[span.kind]],
    [copy.status, copy.statuses[span.status]],
  ];
  if (span.target) facts.push([copy.target, span.target === "local" ? t.aiRuns.viaLocal : t.aiRuns.viaCloud]);
  if (span.model) facts.push([copy.model, span.model]);
  if (span.firstTokenAt != null) facts.push([copy.ttft, formatMs(span.firstTokenAt - span.startedAt)]);
  if (span.usage) {
    facts.push([
      copy.tokens,
      `${formatTokens(span.usage.promptTokens)} in / ${formatTokens(span.usage.completionTokens)} out`,
    ]);
  }
  if (span.costUsd != null && span.kind === "generation") facts.push([copy.cost, formatUsd(span.costUsd)]);

  return (
    <div className="space-y-2 border-t border-violet-100 bg-violet-50/30 px-4 py-3 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="text-violet-950">{value}</dd>
          </div>
        ))}
      </dl>
      {span.statusMessage && (
        <p
          className={`rounded px-2 py-1 ${
            span.status === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"
          }`}
        >
          {span.statusMessage}
        </p>
      )}
      <Block label={copy.input} text={span.input} />
      <Block label={copy.output} text={span.output} />
      {span.metadata && Object.keys(span.metadata).length > 0 && (
        <Block label={copy.metadata} text={JSON.stringify(span.metadata, null, 2)} />
      )}
    </div>
  );
}

function prettify(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

function Block({ label, text }: { label: string; text: string | null }) {
  if (text == null || text === "") return null;
  return (
    <div>
      <p className="mb-0.5 font-medium text-zinc-500">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-violet-100 bg-white p-2 font-mono text-[11px] text-zinc-800">
        {prettify(text)}
      </pre>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white p-2.5 shadow-sm">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-violet-950">{value}</p>
      {hint && <p className="text-[11px] tabular-nums text-zinc-400">{hint}</p>}
    </div>
  );
}
