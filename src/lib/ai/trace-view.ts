/** Pure helpers for the /ai/runs/[id] waterfall (kept out of the component for tests). */
import type { TraceSpan } from "./trace";

export type WaterfallRow = {
  span: TraceSpan;
  depth: number;
  /** Bar position within the trace window, 0–100. */
  offsetPct: number;
  widthPct: number;
  /** Start → first token, as a share of the bar (generations only). */
  ttftPct: number | null;
  durationMs: number;
};

export type TraceSummary = {
  startedAt: number;
  durationMs: number;
  spans: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  errors: number;
  warnings: number;
};

const endOf = (span: TraceSpan) => span.endedAt ?? span.startedAt;

/** Depth-first, children by start time; orphans (parent pruned) are treated as roots. */
export function buildWaterfall(spans: TraceSpan[]): WaterfallRow[] {
  if (spans.length === 0) return [];
  const ids = new Set(spans.map((s) => s.id));
  const children = new Map<string | null, TraceSpan[]>();
  for (const span of spans) {
    const key = span.parentId && ids.has(span.parentId) ? span.parentId : null;
    children.set(key, [...(children.get(key) ?? []), span]);
  }
  for (const list of children.values()) list.sort((a, b) => a.startedAt - b.startedAt);

  const start = Math.min(...spans.map((s) => s.startedAt));
  const end = Math.max(...spans.map(endOf));
  const windowMs = Math.max(1, end - start);

  const rows: WaterfallRow[] = [];
  const visit = (span: TraceSpan, depth: number) => {
    const durationMs = endOf(span) - span.startedAt;
    rows.push({
      span,
      depth,
      offsetPct: ((span.startedAt - start) / windowMs) * 100,
      widthPct: (durationMs / windowMs) * 100,
      ttftPct:
        span.firstTokenAt != null && durationMs > 0
          ? Math.min(100, ((span.firstTokenAt - span.startedAt) / durationMs) * 100)
          : null,
      durationMs,
    });
    for (const child of children.get(span.id) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  return rows;
}

export function summarizeTrace(spans: TraceSpan[]): TraceSummary | null {
  if (spans.length === 0) return null;
  const startedAt = Math.min(...spans.map((s) => s.startedAt));
  const generations = spans.filter((s) => s.kind === "generation");
  return {
    startedAt,
    durationMs: Math.max(...spans.map(endOf)) - startedAt,
    spans: spans.length,
    llmCalls: generations.length,
    toolCalls: spans.filter((s) => s.kind === "tool").length,
    promptTokens: generations.reduce((n, s) => n + (s.usage?.promptTokens ?? 0), 0),
    completionTokens: generations.reduce((n, s) => n + (s.usage?.completionTokens ?? 0), 0),
    costUsd: generations.reduce((n, s) => n + (s.costUsd ?? 0), 0),
    errors: spans.filter((s) => s.status === "error").length,
    warnings: spans.filter((s) => s.status === "warning").length,
  };
}
