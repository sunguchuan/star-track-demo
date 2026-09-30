import { setRunFeedback, type AiRunFeedback } from "@/lib/ai/runs";

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
    return Response.json({ id, feedback });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save feedback";
    return Response.json({ error: message }, { status: 500 });
  }
}
