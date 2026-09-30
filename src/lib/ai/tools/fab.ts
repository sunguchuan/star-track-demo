import {
  getBatchById,
  getFabSummary,
  listAlerts,
  listBatches,
} from "@/lib/fab/queries";
import type { ToolDefinition } from "./types";

function clampLimit(raw: unknown, fallback = 10): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 50));
}

export const FAB_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_fab_summary",
    description:
      "Get fab KPI summary: batch count, open/critical alerts, average yield, latest batch, daily yield trend.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_fab_batches",
    description:
      "List recent production batches with tool, area, yield, scrap, and shift. Newest first.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (1–50). Default 10.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_fab_alerts",
    description:
      "List fab alerts with severity, code, message, and linked batch. Prefer openOnly=true for active issues.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (1–50). Default 10.",
        },
        openOnly: {
          type: "boolean",
          description: "If true, only unacknowledged alerts. Default true.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_fab_batch",
    description: "Get one batch by id (e.g. B-2026-0901-03).",
    parameters: {
      type: "object",
      properties: {
        batchId: {
          type: "string",
          description: "Batch id to look up.",
        },
      },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
];

export function executeFabTool(
  name: string,
  argsJson: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  let args: Record<string, unknown> = {};
  if (argsJson.trim()) {
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      return { ok: false, error: `Invalid JSON arguments: ${argsJson}` };
    }
  }

  try {
    switch (name) {
      case "get_fab_summary":
        return { ok: true, data: getFabSummary() };
      case "list_fab_batches":
        return {
          ok: true,
          data: listBatches(clampLimit(args.limit, 10)),
        };
      case "list_fab_alerts":
        return {
          ok: true,
          data: listAlerts({
            limit: clampLimit(args.limit, 10),
            openOnly: args.openOnly === false ? false : true,
          }),
        };
      case "get_fab_batch": {
        const batchId =
          typeof args.batchId === "string" ? args.batchId.trim() : "";
        if (!batchId) {
          return { ok: false, error: "batchId is required" };
        }
        const batch = getBatchById(batchId);
        if (!batch) {
          return { ok: false, error: `Batch not found: ${batchId}` };
        }
        return { ok: true, data: batch };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
