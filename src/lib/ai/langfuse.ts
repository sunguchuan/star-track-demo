/**
 * Replays a finished RunTrace to Langfuse through its official OpenTelemetry SDK.
 *
 * - Isolated tracer provider: only these spans are exported, never Next.js internals.
 * - Ids are preserved: the Langfuse trace id is the run id (without dashes) and every
 *   observation id is the local span id, so /ai/runs/[id] and Langfuse point at the same tree.
 * - Called from `after()` once the response is done, then flushed, so it also works on Vercel.
 * - Content is already redacted/truncated by trace.ts; LANGFUSE_EXPORT_CONTENT=false drops it.
 */
import { randomBytes } from "crypto";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseOtelSpanAttributes,
  setLangfuseTracerProvider,
  startObservation,
  type LangfuseGenerationAttributes,
  type LangfuseSpanAttributes,
} from "@langfuse/tracing";
import { TraceFlags, type Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, type IdGenerator } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  DEFAULT_SERVICE_NAME,
  getLangfuseBaseUrl,
  getLangfuseEnvironment,
  shouldExportContent,
  type TraceExportMeta,
} from "./langfuse-config";
import type { RunTrace, TraceSpan } from "./trace";

/** Hands out the ids queued for the next span, falling back to random ones. */
class ReplayIdGenerator implements IdGenerator {
  nextTraceId: string | null = null;
  nextSpanId: string | null = null;

  generateTraceId(): string {
    const id = this.nextTraceId ?? randomBytes(16).toString("hex");
    this.nextTraceId = null;
    return id;
  }

  generateSpanId(): string {
    const id = this.nextSpanId ?? randomBytes(8).toString("hex");
    this.nextSpanId = null;
    return id;
  }
}

type Exporter = { processor: LangfuseSpanProcessor; ids: ReplayIdGenerator };

let exporter: Exporter | null = null;

function getExporter(): Exporter {
  if (exporter) return exporter;
  const ids = new ReplayIdGenerator();
  const release =
    process.env.LANGFUSE_RELEASE?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) ||
    undefined;
  const processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY?.trim(),
    secretKey: process.env.LANGFUSE_SECRET_KEY?.trim(),
    baseUrl: getLangfuseBaseUrl(),
    environment: getLangfuseEnvironment(),
    release,
  });
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    ...(release ? { [ATTR_SERVICE_VERSION]: release } : {}),
  });
  setLangfuseTracerProvider(
    new BasicTracerProvider({ resource, idGenerator: ids, spanProcessors: [processor] }),
  );
  exporter = { processor, ids };
  return exporter;
}

const LEVELS = { ok: "DEFAULT", warning: "WARNING", error: "ERROR" } as const;

/** Langfuse embeddings take the same model / usage / cost attributes as generations. */
const isModelCall = (span: TraceSpan) => span.kind === "generation" || span.kind === "embedding";

/** Local span → Langfuse observation attributes (exported for tests). */
export function toObservationAttributes(
  span: TraceSpan,
  includeContent: boolean,
): LangfuseGenerationAttributes {
  const attrs: LangfuseGenerationAttributes = {
    level: LEVELS[span.status],
    metadata: {
      ...span.metadata,
      ...(span.target ? { target: span.target } : {}),
      ...(span.model && !isModelCall(span) ? { model: span.model } : {}),
    },
  };
  if (span.statusMessage) attrs.statusMessage = span.statusMessage;
  if (includeContent) {
    if (span.input != null) attrs.input = span.input;
    if (span.output != null) attrs.output = span.output;
  }
  if (isModelCall(span)) {
    if (span.model) attrs.model = span.model;
    if (span.firstTokenAt != null) attrs.completionStartTime = new Date(span.firstTokenAt);
    if (span.usage) {
      attrs.usageDetails = {
        input: span.usage.promptTokens,
        output: span.usage.completionTokens,
        total: span.usage.promptTokens + span.usage.completionTokens,
      };
    }
    // Always explicit (0 for local) so Langfuse never prices our models from its own table.
    if (span.costUsd != null) attrs.costDetails = { total: span.costUsd };
  }
  return attrs;
}

/** Trace-level attributes, set on every span as Langfuse's propagation would. */
export function toTraceAttributes(meta: TraceExportMeta): Attributes {
  return {
    [LangfuseOtelSpanAttributes.TRACE_NAME]: `ai.chat/${meta.taskType}`,
    [LangfuseOtelSpanAttributes.TRACE_TAGS]: meta.tags,
    [`${LangfuseOtelSpanAttributes.TRACE_METADATA}.runId`]: meta.runId,
    [`${LangfuseOtelSpanAttributes.TRACE_METADATA}.status`]: meta.status,
  };
}

export async function exportRunTrace(trace: RunTrace, meta: TraceExportMeta): Promise<void> {
  try {
    const { processor, ids } = getExporter();
    const includeContent = shouldExportContent();
    const traceAttributes = toTraceAttributes(meta);
    const started: { end: (at: Date) => void; endedAt: number }[] = [];

    // Spans are stored in creation order, so every parent precedes its children.
    for (const span of trace.spans) {
      if (!span.parentId) ids.nextTraceId = trace.id;
      ids.nextSpanId = span.id;
      const observation = startObservation(
        span.name,
        toObservationAttributes(span, includeContent) as LangfuseSpanAttributes,
        {
          asType: span.kind as "span",
          startTime: new Date(span.startedAt),
          parentSpanContext: span.parentId
            ? { traceId: trace.id, spanId: span.parentId, traceFlags: TraceFlags.SAMPLED }
            : undefined,
        },
      );
      observation.otelSpan.setAttributes(traceAttributes);
      started.push({
        end: (at) => observation.end(at),
        endedAt: span.endedAt ?? span.startedAt,
      });
    }
    for (const { end, endedAt } of started.reverse()) end(new Date(endedAt));
    await processor.forceFlush();
  } catch (err) {
    console.error("[langfuse] trace export failed", err);
  }
}
