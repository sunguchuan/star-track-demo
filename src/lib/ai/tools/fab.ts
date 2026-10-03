import {
  getBatchById,
  getFabSummary,
  listAlerts,
  listAlertsForBatch,
  listBatches,
} from "@/lib/fab/queries";
import type { ToolDefinition } from "./types";

const BATCH_ID_PATTERN = /^B-\d{6}-\d{2}$/;

export type FabToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      error: string;
      kind: "invalid_args" | "not_found" | "unknown_tool" | "internal";
    };

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
    description:
      "Get one batch by id (format B-YYMMDD-NN, e.g. B-240909-01), including all alerts linked to that batch.",
    parameters: {
      type: "object",
      properties: {
        batchId: {
          type: "string",
          description: "Batch id to look up, format B-YYMMDD-NN.",
        },
      },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
];

export function executeFabTool(name: string, argsJson: string): FabToolResult {
  let args: Record<string, unknown> = {};
  if (argsJson.trim()) {
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      return {
        ok: false,
        kind: "invalid_args",
        error: `Invalid JSON arguments: ${argsJson.slice(0, 200)}`,
      };
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
          return { ok: false, kind: "invalid_args", error: "batchId is required" };
        }
        if (!BATCH_ID_PATTERN.test(batchId)) {
          return {
            ok: false,
            kind: "invalid_args",
            error: `Invalid batchId format: ${batchId.slice(0, 40)} (expected B-YYMMDD-NN)`,
          };
        }
        const batch = getBatchById(batchId);
        if (!batch) {
          return { ok: false, kind: "not_found", error: `Batch not found: ${batchId}` };
        }
        return {
          ok: true,
          data: { ...batch, alerts: listAlertsForBatch(batchId) },
        };
      }
      default:
        return { ok: false, kind: "unknown_tool", error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "internal", error: message };
  }
}
