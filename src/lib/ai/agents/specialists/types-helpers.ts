import type { ToolCallRequest } from "../../tools/types";

/** Tool-call IDs shared by specialist definitions and the generic runner. */
export const AUTO_ALERTS_CALL_ID = "auto_alerts";
export const FORCED_CALL_ID_PREFIX = "force_";

export type ToolCallSource = "model" | "auto" | "forced";

export function toolCallSource(id: string): ToolCallSource {
  if (id === AUTO_ALERTS_CALL_ID) return "auto";
  return id.startsWith(FORCED_CALL_ID_PREFIX) ? "forced" : "model";
}

/** Add open alerts when a selection omitted them; alerts are the core investigation signal. */
export function withOpenAlerts(
  calls: ToolCallRequest[],
  maxCalls: number,
): ToolCallRequest[] {
  if (calls.length >= maxCalls || calls.some((call) => call.name === "list_fab_alerts")) {
    return calls;
  }
  return [
    ...calls,
    {
      id: AUTO_ALERTS_CALL_ID,
      name: "list_fab_alerts",
      arguments: JSON.stringify({ limit: 10, openOnly: true }),
    },
  ];
}
