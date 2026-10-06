import { setRunFeedback, type AiRunFeedback } from "@/lib/ai/runs";
import { evictForRun } from "@/lib/ai/semantic-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ai/runs/:id/feedback — body { score: 1 | -1 | 0 }; 0 clears the rating */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let score: unknown;
  try {
    score = ((await request.json()) as { score?: unknown })?.score;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (score !== 1 && score !== -1 && score !== 0) {
    return Response.json(
      { error: "score must be 1, -1, or 0" },
      { status: 400 },
    );
  }

  try {
    const feedback: AiRunFeedback | null = score === 0 ? null : score;
    if (!setRunFeedback(id, feedback)) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    // A bad answer must not be served again from the cache.
    const evicted = feedback === -1 ? evictForRun(id) : 0;
    return Response.json({ id, feedback, evicted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save feedback";
    return Response.json({ error: message }, { status: 500 });
  }
}
