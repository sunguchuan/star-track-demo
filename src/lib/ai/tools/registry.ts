import { executeFabTool, FAB_TOOL_DEFINITIONS, type FabToolResult } from "./fab";
import type { KnowledgeSource } from "../types";
import {
  executeKnowledgeTool,
  isKnowledgeEnabled,
  KNOWLEDGE_TOOL_DEFINITION,
  KNOWLEDGE_TOOL_NAME,
  type ToolContext,
} from "./knowledge";
import type { OpenAiTool, ToolDefinition } from "./types";

export type { ToolContext } from "./knowledge";

/** Fab data tools only (batches, alerts, summary). */
export function listFabToolDefinitions(): ToolDefinition[] {
  return [...FAB_TOOL_DEFINITIONS];
}

/** Knowledge search only; empty when AI_RAG=off. */
export function listKnowledgeToolDefinitions(): ToolDefinition[] {
  return isKnowledgeEnabled() ? [KNOWLEDGE_TOOL_DEFINITION] : [];
}

/** Fab data tools, plus knowledge search unless AI_RAG=off. */
export function listToolDefinitions(): ToolDefinition[] {
  return [...listFabToolDefinitions(), ...listKnowledgeToolDefinitions()];
}

/** Allowlist check: the model may only invoke tools from `defs` (defaults to all registered). */
export function isAllowedTool(name: string, defs: ToolDefinition[] = listToolDefinitions()): boolean {
  return defs.some((d) => d.name === name);
}

export function toOpenAiTools(defs: ToolDefinition[] = listToolDefinitions()): OpenAiTool[] {
  return defs.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

/**
 * `content` is the model-facing rendering when a tool provides its own (knowledge passages);
 * `sources` are the documents behind it, shown in the UI.
 */
export type ToolResult =
  | { ok: true; data: unknown; content?: string; sources?: KnowledgeSource[] }
  | Extract<FabToolResult, { ok: false }>;

export async function executeTool(name: string, argsJson: string, ctx: ToolContext): Promise<ToolResult> {
  if (name === KNOWLEDGE_TOOL_NAME && isKnowledgeEnabled()) return executeKnowledgeTool(argsJson, ctx);
  return executeFabTool(name, argsJson);
}
