import { getFabSummary } from "@/lib/fab/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/fab/summary — KPI + yield trend for the demo FAB dataset */
export async function GET() {
  try {
    const summary = getFabSummary();
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read FAB DB";
    return Response.json({ error: message }, { status: 500 });
  }
}
