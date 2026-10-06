import { FabInvestigatePanel } from "@/components/fab-investigate-panel";
import { SiteHeader } from "@/components/site-header";
import { getFabSummary, listAlerts, listBatches } from "@/lib/fab/queries";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "FAB Ops Demo | 星迹",
  description: "SQLite-backed demo batches and alerts for manufacturing co-pilot",
};

function severityClass(severity: string): string {
  if (severity === "critical") return "bg-red-100 text-red-800";
  if (severity === "warn") return "bg-amber-100 text-amber-900";
  return "bg-sky-100 text-sky-800";
}

export default function FabPage() {
  const summary = getFabSummary();
  const batches = listBatches(8);
  const alerts = listAlerts({ limit: 8, openOnly: false });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <Link
          href="/"
          className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
        >
          ← 返回首页
        </Link>

        <h1 className="text-2xl font-bold text-violet-950">FAB Ops Demo</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Manufacturing co-pilot demo: SQLite store + query APIs for batches
          and alerts, with a tool-calling investigate agent on top. Data is
          synthetic (etch yield dip story).
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          APIs:{" "}
          <code className="rounded bg-violet-50 px-1">/api/fab/summary</code>{" "}
          <code className="rounded bg-violet-50 px-1">/api/fab/batches</code>{" "}
          <code className="rounded bg-violet-50 px-1">/api/fab/alerts</code>{" "}
          <code className="rounded bg-violet-50 px-1">/api/fab/knowledge</code>
        </p>

        <section className="mt-6 grid grid-cols-2 gap-3">
          <Stat label="Batches" value={String(summary.batchCount)} />
          <Stat
            label="Avg yield"
            value={
              summary.avgYieldPct == null ? "—" : `${summary.avgYieldPct}%`
            }
          />
          <Stat label="Open alerts" value={String(summary.openAlertCount)} />
          <Stat
            label="Critical open"
            value={String(summary.criticalAlertCount)}
          />
        </section>

        <div className="mt-6">
          <FabInvestigatePanel />
        </div>

        {summary.yieldTrend.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
              Yield by day
            </h2>
            <ul className="space-y-1.5 rounded-xl border border-violet-100 bg-white p-3">
              {summary.yieldTrend.map((point) => (
                <li
                  key={point.day}
                  className="flex items-center gap-3 text-sm text-violet-950"
                >
                  <span className="w-24 shrink-0 tabular-nums text-zinc-500">
                    {point.day.slice(5)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-50">
                    <div
                      className={`h-full rounded-full ${
                        point.avgYieldPct < 93
                          ? "bg-red-400"
                          : point.avgYieldPct < 95
                            ? "bg-amber-400"
                            : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, point.avgYieldPct))}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right tabular-nums">
                    {point.avgYieldPct}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
            Recent batches
          </h2>
          <ul className="space-y-3">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-violet-800">{batch.id}</span>
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
                    {batch.productLine}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      batch.yieldPct < 93
                        ? "bg-red-100 text-red-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {batch.yieldPct}% yield
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-600">
                  {batch.toolName} · shift {batch.shift} · {batch.waferCount}{" "}
                  wafers · scrap {batch.scrapCount}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {new Date(batch.startedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
            Alerts
          </h2>
          <ul className="space-y-3">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${severityClass(alert.severity)}`}
                  >
                    {alert.severity}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">
                    {alert.code}
                  </span>
                  {alert.acknowledged ? (
                    <span className="text-zinc-400">acked</span>
                  ) : (
                    <span className="font-medium text-violet-700">open</span>
                  )}
                </div>
                <p className="text-sm font-medium text-violet-950">
                  {alert.message}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {alert.toolName}
                  {alert.batchId ? ` · ${alert.batchId}` : ""} ·{" "}
                  {new Date(alert.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white p-3 shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-violet-950">
        {value}
      </p>
    </div>
  );
}
