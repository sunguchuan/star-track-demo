import { FAB_TOOL_DEFINITIONS } from "./fab";
import type { OpenAiTool, ToolDefinition } from "./types";

export function listToolDefinitions(): ToolDefinition[] {
  return FAB_TOOL_DEFINITIONS;
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
