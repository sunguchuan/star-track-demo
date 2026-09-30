import { listAlerts } from "@/lib/fab/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/fab/alerts?limit=20&openOnly=1 — tool / yield alerts */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "20");
    const openOnly =
      searchParams.get("openOnly") === "1" ||
      searchParams.get("openOnly") === "true";
    const alerts = listAlerts({
      limit: Number.isFinite(limit) ? limit : 20,
      openOnly,
    });
    return Response.json({ items: alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read alerts";
    return Response.json({ error: message }, { status: 500 });
  }
}
