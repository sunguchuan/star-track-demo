"use client";

import type { AiRunRecord, AiRunStats, LatencyStats } from "@/lib/ai/runs";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function pair(a: number | null, b: number | null): string {
  return `${formatMs(a)} / ${formatMs(b)}`;
}

export function AiRunsContent({
  stats,
  runs,
}: {
  stats: AiRunStats;
  runs: AiRunRecord[];
}) {
  const { t, locale } = useLocale();
  const copy = t.aiRuns;
  const rated = stats.feedbackUp + stats.feedbackDown;

  const statusLabel = (status: AiRunRecord["status"]) =>
    status === "ok"
      ? copy.statusOk
      : status === "aborted"
        ? copy.statusAborted
        : copy.statusError;

  const routeRows: { key: "local" | "cloud"; label: string; data: LatencyStats }[] = [
    { key: "local", label: copy.viaLocal, data: stats.byVia.local },
    { key: "cloud", label: copy.viaCloud, data: stats.byVia.cloud },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/ai"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {copy.backToAi}
      </Link>

      <h1 className="text-2xl font-bold text-violet-950">{copy.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">{copy.intro}</p>

      {stats.total === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-10 text-center text-sm text-violet-700/80">
          {copy.empty}
        </p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={copy.totalRuns} value={String(stats.total)} />
            <Stat
              label={copy.localShare}
              value={pct(stats.localCount, stats.total)}
            />
            <Stat
              label={copy.fallbackRate}
              value={pct(stats.fallbackCount, stats.total)}
            />
            <Stat
              label={copy.errorRate}
              value={pct(stats.errorCount, stats.total)}
            />
            <Stat
              label={copy.ttftP50}
              value={formatMs(stats.latency.ttftP50)}
            />
            <Stat
              label={copy.satisfaction}
              value={rated === 0 ? copy.noFeedback : pct(stats.feedbackUp, rated)}
              hint={rated === 0 ? undefined : `${stats.feedbackUp} / ${rated}`}
            />
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
              {copy.byRoute}
            </h2>
            <div className="overflow-hidden rounded-xl border border-violet-100 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-violet-50/60 text-left text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{copy.colRoute}</th>
                    <th className="px-3 py-2 font-medium">{copy.colRuns}</th>
                    <th className="px-3 py-2 font-medium">{copy.colTtft}</th>
                    <th className="px-3 py-2 font-medium">{copy.colTotal}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-violet-950">
                  {routeRows.map((row) => (
                    <tr key={row.key} className="border-t border-violet-50">
                      <td className="px-3 py-2">
                        <ViaBadge via={row.key} label={row.label} />
                      </td>
                      <td className="px-3 py-2">{row.data.count}</td>
                      <td className="px-3 py-2">
                        {pair(row.data.ttftP50, row.data.ttftP95)}
                      </td>
                      <td className="px-3 py-2">
                        {pair(row.data.totalP50, row.data.totalP95)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{copy.latencyNote}</p>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
              {copy.byTask}
            </h2>
            <ul className="space-y-1.5 rounded-xl border border-violet-100 bg-white p-3">
              {stats.byTask.map((row) => (
                <li
                  key={row.taskType}
                  className="flex items-center gap-3 text-sm text-violet-950"
                >
                  <span className="w-24 shrink-0 text-zinc-600">
                    {t.aiPage.tasks[row.taskType] ?? row.taskType}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-50">
                    <div
                      className="h-full rounded-full bg-violet-400"
                      style={{ width: `${(row.count / stats.total) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums">
                    {row.count}
                    {row.errorCount > 0 && (
                      <span className="ml-1 text-xs text-red-600">
                        ({row.errorCount} {copy.failedSuffix})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
              {copy.recent}
            </h2>
            <ul className="space-y-3">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-violet-900">
                      {t.aiPage.tasks[run.taskType] ?? run.taskType}
                    </span>
                    <ViaBadge
                      via={run.via}
                      label={run.via === "local" ? copy.viaLocal : copy.viaCloud}
                    />
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
                      {run.model}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        run.status === "ok"
                          ? "bg-emerald-50 text-emerald-700"
                          : run.status === "aborted"
                            ? "bg-zinc-100 text-zinc-600"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {statusLabel(run.status)}
                      {run.status === "error" && run.errorCode
                        ? ` · ${run.errorCode}`
                        : ""}
                    </span>
                    {run.fellBack && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                        {copy.fellBack}
                      </span>
                    )}
                    {run.feedback != null && (
                      <span
                        className={
                          run.feedback === 1 ? "text-emerald-700" : "text-zinc-500"
                        }
                      >
                        {run.feedback === 1 ? copy.feedbackUp : copy.feedbackDown}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-zinc-600">
                    {copy.ttft} {formatMs(run.ttftMs)} · {copy.total}{" "}
                    {formatMs(run.totalMs)}
                    {run.toolCalls > 0 && ` · ${copy.tools} ${run.toolCalls}`}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    <time dateTime={run.createdAt} suppressHydrationWarning>
                      {new Date(run.createdAt).toLocaleString(
                        locale === "zh" ? "zh-CN" : "en-US",
                      )}
                    </time>
                    {" · "}
                    {run.reason}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white p-3 shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-violet-950">
        {value}
      </p>
      {hint && <p className="text-xs tabular-nums text-zinc-400">{hint}</p>}
    </div>
  );
}

function ViaBadge({ via, label }: { via: "local" | "cloud"; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        via === "local"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-sky-100 text-sky-800"
      }`}
    >
      {label}
    </span>
  );
}
