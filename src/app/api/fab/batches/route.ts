import { listBatches } from "@/lib/fab/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/fab/batches?limit=20 — recent process batches with yield */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "20");
    const batches = listBatches(Number.isFinite(limit) ? limit : 20);
    return Response.json({ items: batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read batches";
    return Response.json({ error: message }, { status: 500 });
  }
}
