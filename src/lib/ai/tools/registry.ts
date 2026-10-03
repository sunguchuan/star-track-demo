import { FAB_TOOL_DEFINITIONS } from "./fab";
import type { OpenAiTool, ToolDefinition } from "./types";

export function listToolDefinitions(): ToolDefinition[] {
  return FAB_TOOL_DEFINITIONS;
}

const ALLOWED_TOOL_NAMES = new Set(FAB_TOOL_DEFINITIONS.map((d) => d.name));

/** Allowlist check: the model may only invoke tools we advertised. */
export function isAllowedTool(name: string): boolean {
  return ALLOWED_TOOL_NAMES.has(name);
}

export function toOpenAiTools(defs: ToolDefinition[] = FAB_TOOL_DEFINITIONS): OpenAiTool[] {
  return defs.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}
