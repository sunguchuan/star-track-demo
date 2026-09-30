import { getRunStats, listRuns } from "@/lib/ai/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/runs?limit= — aggregate stats + most recent Gateway runs */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  try {
    return Response.json({
      stats: getRunStats(),
      runs: listRuns(Number.isFinite(limit) ? limit : 20),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read run log";
    return Response.json({ error: message }, { status: 500 });
  }
}
