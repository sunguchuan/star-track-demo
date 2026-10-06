/**
 * Langfuse settings, kept apart from langfuse.ts so the Gateway can check them without
 * loading the OpenTelemetry packages on every request.
 */

export const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";

/** OpenTelemetry service.name on exported spans; OTEL_SERVICE_NAME overrides it. */
export const DEFAULT_SERVICE_NAME = "star-track-demo";

/** Trace-level fields the replay attaches to every observation. */
export type TraceExportMeta = {
  runId: string;
  taskType: string;
  status: string;
  tags: string[];
};

export function isLangfuseEnabled(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}

export function getLangfuseBaseUrl(): string {
  return (process.env.LANGFUSE_BASE_URL?.trim() || DEFAULT_LANGFUSE_BASE_URL).replace(/\/+$/, "");
}

/**
 * Span input/output text is sent unless LANGFUSE_EXPORT_CONTENT=false; it is already
 * redacted and truncated by trace.ts either way.
 */
export function shouldExportContent(): boolean {
  return process.env.LANGFUSE_EXPORT_CONTENT?.trim().toLowerCase() !== "false";
}

/** e.g. "production" / "preview" on Vercel, "development" locally. */
export function getLangfuseEnvironment(): string {
  return (
    process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ||
    process.env.VERCEL_ENV?.trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "development")
  );
}

/** Deep link into the Langfuse UI; needs the project id, which the keys alone don't reveal. */
export function getLangfuseTraceUrl(traceId: string): string | null {
  const projectId = process.env.LANGFUSE_PROJECT_ID?.trim();
  if (!projectId || !isLangfuseEnabled()) return null;
  return `${getLangfuseBaseUrl()}/project/${projectId}/traces/${traceId}`;
}
