/**
 * LangChain adapters for the existing fab / knowledge tools.
 *
 * The tool definitions and executors stay in fab.ts / knowledge.ts / registry.ts.
 * This module only wraps them as LangChain StructuredTools so specialists (and
 * later create_agent / MCP-style demos) can invoke the same business logic
 * through the LangChain tool interface.
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { RunTrace } from "../trace";
import {
  executeTool,
  listFabToolDefinitions,
  listKnowledgeToolDefinitions,
  listToolDefinitions,
  type ToolContext,
  type ToolResult,
} from "./registry";
import type { ToolDefinition } from "./types";

export type LangChainFabTool = DynamicStructuredTool;

function parseArgsJson(argsJson: string): {
  ok: true;
  args: Record<string, unknown>;
} | {
  ok: false;
  error: string;
} {
  if (!argsJson.trim()) return { ok: true, args: {} };
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
    return { ok: false, error: "Tool arguments must be a JSON object" };
  } catch {
    return {
      ok: false,
      error: `Invalid JSON arguments: ${argsJson.slice(0, 200)}`,
    };
  }
}

function modelFacingText(result: ToolResult): string {
  if (!result.ok) return `ERROR ${result.kind}: ${result.error}`;
  return result.content ?? JSON.stringify(result.data);
}

/**
 * Wrap one of our ToolDefinitions as a LangChain StructuredTool.
 * JSON Schema is passed through; argument checks stay in executeTool.
 */
export function toLangChainTool(
  def: ToolDefinition,
  ctx: ToolContext,
): LangChainFabTool {
  return new DynamicStructuredTool({
    name: def.name,
    description: def.description,
    schema: def.parameters,
    func: async (input) => {
      const result = await executeTool(
        def.name,
        JSON.stringify(input ?? {}),
        ctx,
      );
      return modelFacingText(result);
    },
  });
}

export function listFabLangChainTools(ctx: ToolContext): LangChainFabTool[] {
  return listFabToolDefinitions().map((def) => toLangChainTool(def, ctx));
}

export function listKnowledgeLangChainTools(
  ctx: ToolContext,
): LangChainFabTool[] {
  return listKnowledgeToolDefinitions().map((def) => toLangChainTool(def, ctx));
}

export function listAllLangChainTools(ctx: ToolContext): LangChainFabTool[] {
  return listToolDefinitions().map((def) => toLangChainTool(def, ctx));
}

/**
 * Execute a registered tool through LangChain's invoke path, while still
 * returning our structured ToolResult for traces, UI previews and grounding.
 */
export async function executeToolViaLangChain(
  name: string,
  argsJson: string,
  ctx: ToolContext,
  defs: ToolDefinition[] = listToolDefinitions(),
): Promise<ToolResult> {
  const def = defs.find((item) => item.name === name);
  if (!def) {
    return { ok: false, kind: "unknown_tool", error: `Unknown tool: ${name}` };
  }

  const parsed = parseArgsJson(argsJson);
  if (!parsed.ok) {
    return { ok: false, kind: "invalid_args", error: parsed.error };
  }

  let captured: ToolResult | null = null;
  const tool = new DynamicStructuredTool({
    name: def.name,
    description: def.description,
    schema: def.parameters,
    func: async (input) => {
      captured = await executeTool(
        def.name,
        JSON.stringify(input ?? {}),
        ctx,
      );
      return modelFacingText(captured);
    },
  });

  try {
    await tool.invoke(parsed.args);
  } catch (err) {
    if (captured) return captured;
    return {
      ok: false,
      kind: "internal",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return (
    captured ?? {
      ok: false,
      kind: "internal",
      error: `LangChain tool "${name}" returned no result`,
    }
  );
}

/** Detached tool context for tests / one-off LangChain demos outside a run span. */
export function detachedToolContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const span =
    overrides.span ??
    new RunTrace(crypto.randomUUID()).start("langchain.tool", "tool");
  return {
    target: overrides.target ?? "local",
    signal: overrides.signal ?? new AbortController().signal,
    span,
    onUsage: overrides.onUsage,
    language: overrides.language,
  };
}
