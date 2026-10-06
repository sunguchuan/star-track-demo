/**
 * Per-run call tree for the AI Gateway: every guardrail pass, attempt, model call and tool call
 * becomes a span with timing, first-token time, token usage and cost.
 *
 * Vendor-neutral on purpose: spans are plain data, stored locally (ai_spans) for the /ai/runs
 * waterfall and replayed to Langfuse afterwards when it is configured (langfuse.ts).
 * Inputs/outputs are redacted and truncated on the way in, so no sink ever sees raw secrets.
 */
import { randomBytes } from "crypto";
import { redactSensitive } from "./guardrails/input";
import { priceForModel, priceTokens, type ModelPrice } from "./pricing";
import type { AiRouteTarget, TokenUsage } from "./types";

/** Usage forwarded from a span, tagged with the model that produced it (for per-model pricing). */
export type UsageCallback = (usage: TokenUsage, model?: string | null) => void;

/** Mirrors Langfuse observation types so the replay is a 1:1 mapping. */
export type SpanKind =
  | "span"
  | "agent"
  | "generation"
  | "embedding"
  | "retriever"
  | "tool"
  | "guardrail";
export type SpanStatus = "ok" | "warning" | "error";

export type TraceSpan = {
  /** 16 hex chars (OpenTelemetry span id). */
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  /** Epoch ms. */
  startedAt: number;
  endedAt: number | null;
  status: SpanStatus;
  statusMessage: string | null;
  target: AiRouteTarget | null;
  model: string | null;
  input: string | null;
  output: string | null;
  usage: TokenUsage | null;
  /** Cloud spend only; local calls are free. */
  costUsd: number | null;
  firstTokenAt: number | null;
  metadata: Record<string, unknown> | null;
};

export type SpanInit = {
  input?: unknown;
  model?: string;
  target?: AiRouteTarget;
  metadata?: Record<string, unknown>;
};

export type SpanUpdate = {
  output?: unknown;
  model?: string;
  target?: AiRouteTarget;
  metadata?: Record<string, unknown>;
  status?: SpanStatus;
  statusMessage?: string | null;
};

export const TRACE_PREVIEW_CHARS = 4000;

/** Redacted, truncated text for span input/output. */
export function tracePreview(value: unknown): string | null {
  if (value == null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = redactSensitive(text);
  return text.length > TRACE_PREVIEW_CHARS
    ? `${text.slice(0, TRACE_PREVIEW_CHARS)}…(+${text.length - TRACE_PREVIEW_CHARS})`
    : text;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

export class Span {
  readonly data: TraceSpan;
  private readonly trace: RunTrace;

  constructor(trace: RunTrace, data: TraceSpan) {
    this.trace = trace;
    this.data = data;
  }

  get id(): string {
    return this.data.id;
  }

  get ended(): boolean {
    return this.data.endedAt != null;
  }

  child(name: string, kind: SpanKind, init: SpanInit = {}): Span {
    return this.trace.start(name, kind, init, this);
  }

  update(patch: SpanUpdate): this {
    const d = this.data;
    if (patch.output !== undefined) d.output = tracePreview(patch.output);
    if (patch.model !== undefined) d.model = patch.model;
    if (patch.target !== undefined) d.target = patch.target;
    if (patch.metadata) d.metadata = { ...d.metadata, ...patch.metadata };
    if (patch.status) d.status = patch.status;
    if (patch.statusMessage !== undefined) d.statusMessage = patch.statusMessage?.slice(0, 500) ?? null;
    return this;
  }

  firstToken(): void {
    this.data.firstTokenAt ??= Date.now();
  }

  addUsage(usage: TokenUsage): void {
    const d = this.data;
    d.usage = {
      promptTokens: (d.usage?.promptTokens ?? 0) + usage.promptTokens,
      completionTokens: (d.usage?.completionTokens ?? 0) + usage.completionTokens,
    };
    d.costUsd = d.target === "cloud" ? priceTokens(d.usage, this.trace.priceFor(d.model)) : 0;
  }

  /** For calls priced differently from chat models (e.g. embeddings). */
  setUsage(usage: TokenUsage, costUsd: number): void {
    this.data.usage = usage;
    this.data.costUsd = costUsd;
  }

  /** Records usage on this span, then forwards it with the span's model (e.g. to the run's UsageMeter). */
  usageSink(next?: UsageCallback): (usage: TokenUsage) => void {
    return (usage) => {
      this.addUsage(usage);
      next?.(usage, this.data.model);
    };
  }

  end(patch: SpanUpdate = {}): void {
    if (this.ended) return;
    this.update(patch);
    this.data.endedAt = Date.now();
  }

  fail(err: unknown, patch: SpanUpdate = {}): void {
    if (this.ended) return;
    this.end({ ...patch, status: "error", statusMessage: errorMessage(err) });
  }
}

export class RunTrace {
  /** 32 hex chars: the run id without dashes, reused as the Langfuse / OTel trace id. */
  readonly id: string;
  readonly spans: TraceSpan[] = [];
  private readonly fixedPrice: ModelPrice | null;

  /** A fixed price applies to every model (tests); otherwise spans are priced by their model. */
  constructor(runId: string, price: ModelPrice | null = null) {
    this.id = runId.replace(/-/g, "").toLowerCase();
    this.fixedPrice = price;
  }

  priceFor(model: string | null): ModelPrice {
    return this.fixedPrice ?? priceForModel(model);
  }

  start(name: string, kind: SpanKind, init: SpanInit = {}, parent: Span | null = null): Span {
    const data: TraceSpan = {
      id: randomBytes(8).toString("hex"),
      parentId: parent?.id ?? null,
      name,
      kind,
      startedAt: Date.now(),
      endedAt: null,
      status: "ok",
      statusMessage: null,
      target: init.target ?? null,
      model: init.model ?? null,
      input: tracePreview(init.input),
      output: null,
      usage: null,
      costUsd: null,
      firstTokenAt: null,
      metadata: init.metadata ?? null,
    };
    this.spans.push(data);
    return new Span(this, data);
  }

  /** Ends spans left open by an abort or a thrown error, so every span has a duration. */
  close(at: number = Date.now()): void {
    for (const span of this.spans) {
      if (span.endedAt != null) continue;
      span.endedAt = at;
      if (span.status === "ok") {
        span.status = "warning";
        span.statusMessage = "not finished (aborted or interrupted)";
      }
    }
  }
}

/**
 * A guardrail pass as an (instant) guardrail span. Blocks and warnings are the guardrail
 * working as designed, so they surface as warnings rather than errors.
 */
export function recordGuardrails(
  parent: Span,
  name: string,
  hits: { rule: string; action: string; detail?: string }[],
  metadata: Record<string, unknown> = {},
): void {
  const span = parent.child(name, "guardrail");
  span.end({
    output: hits.map((h) => ({ rule: h.rule, action: h.action, detail: h.detail })),
    metadata: { ...metadata, hits: hits.length },
    ...(hits.length > 0
      ? { status: "warning" as const, statusMessage: hits.map((h) => `${h.rule}:${h.action}`).join(", ") }
      : {}),
  });
}

/** Runs one non-streaming model call as a generation span. */
export async function traceGeneration<T>(
  parent: Span,
  name: string,
  init: SpanInit,
  run: (span: Span) => Promise<T>,
  outputOf: (result: T) => unknown = (result) => result,
): Promise<T> {
  const span = parent.child(name, "generation", init);
  try {
    const result = await run(span);
    span.end({ output: outputOf(result) });
    return result;
  } catch (err) {
    span.fail(err);
    throw err;
  }
}

/** Wraps a token stream: marks first token, collects output, ends (or fails) the span. */
export async function* traceStream(
  span: Span,
  stream: AsyncIterable<string>,
): AsyncGenerator<string> {
  let output = "";
  try {
    for await (const text of stream) {
      span.firstToken();
      output += text;
      yield text;
    }
    span.end({ output });
  } catch (err) {
    span.fail(err, { output });
    throw err;
  } finally {
    // Consumer stopped early (abort / timeout): keep what was generated.
    span.end({ output, status: "warning", statusMessage: "stream stopped early" });
  }
}
