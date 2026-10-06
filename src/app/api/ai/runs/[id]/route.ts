import { getLangfuseTraceUrl } from "@/lib/ai/langfuse-config";
import { getRunTrace } from "@/lib/ai/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/runs/:id — the run record plus its span tree (empty for untraced runs) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const trace = getRunTrace(id);
    if (!trace) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    return Response.json({
      ...trace,
      langfuseUrl: trace.spans.length > 0 ? getLangfuseTraceUrl(id.replace(/-/g, "")) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load run";
    return Response.json({ error: message }, { status: 500 });
  }
}
