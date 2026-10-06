/**
 * The fab tools as an MCP server. Tool definitions, argument checks, execution and payload
 * caps are the ones the investigate agent uses, so an MCP client (Cursor, Claude Desktop)
 * sees the same data and the same knowledge search, not a parallel implementation.
 *
 * Read-only: every tool is a query; nothing here acknowledges alerts or writes fab data.
 */
import { randomUUID } from "crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { capPayload } from "@/lib/ai/agent";
import { detectReplyLanguage } from "@/lib/ai/language";
import { isCloudConfigured } from "@/lib/ai/router";
import { KNOWLEDGE_TOOL_NAME } from "@/lib/ai/tools/knowledge";
import { executeTool, listToolDefinitions } from "@/lib/ai/tools/registry";
import { RunTrace, type TraceSpan } from "@/lib/ai/trace";
import type { AiRouteTarget } from "@/lib/ai/types";
import { loadCorpus, type KbDoc } from "@/lib/rag/corpus";

export const MCP_SERVER_NAME = "star-track-fab";
export const KB_RESOURCE_PREFIX = "kb://docs/";

const INSTRUCTIONS = `Read-only access to a demo semiconductor fab: KPIs, production batches, alerts, and a knowledge base of alert runbooks, SOPs, incident reports and equipment specs.
- Use get_fab_summary / list_fab_alerts / list_fab_batches / get_fab_batch for facts, and search_fab_knowledge for how to handle an alert, procedures, past incidents and equipment limits.
- Cite batch IDs, alert codes and knowledge document IDs (e.g. RB-ETCH-RF-DRIFT) exactly as returned; do not invent IDs.
- If search_fab_knowledge returns no relevant document, say the knowledge base has none instead of applying a procedure written for another alert or tool.
- Full documents are available as resources at ${KB_RESOURCE_PREFIX}<docId>.`;

export type FabMcpOptions = {
  /** Where knowledge search may run: local keeps queries on the machine (no cloud embedding or rerank). */
  target?: AiRouteTarget;
  /** One line per tool call (stderr in the stdio server: stdout carries the protocol). */
  log?: (line: string) => void;
};

/** MCP_TARGET=cloud enables cloud vectors and reranking when a key is configured; local otherwise. */
export function resolveMcpTarget(env: Record<string, string | undefined> = process.env): AiRouteTarget {
  return env.MCP_TARGET?.trim().toLowerCase() === "cloud" && isCloudConfigured() ? "cloud" : "local";
}

/** The retrieval stages of a call, e.g. "rag.bm25 3ms, rag.vector 41ms". */
function stageTimings(spans: TraceSpan[]): string {
  return spans
    .filter((s) => s.parentId != null && s.endedAt != null)
    .map((s) => `${s.name} ${s.endedAt! - s.startedAt}ms${s.status === "error" ? " (error)" : ""}`)
    .join(", ");
}

export function renderKbDoc(doc: KbDoc): string {
  const meta = [`type: ${doc.type}`, doc.codes.length ? `alerts: ${doc.codes.join(", ")}` : null, doc.updated ? `updated: ${doc.updated}` : null]
    .filter(Boolean)
    .join(" · ");
  const sections = doc.sections.map((s) => `## ${s.heading}\n\n${s.text}`);
  return [`# ${doc.id} · ${doc.title}`, meta, ...sections].join("\n\n");
}

export function createFabMcpServer(options: FabMcpOptions = {}): McpServer {
  const target = options.target ?? resolveMcpTarget();
  const log = options.log ?? (() => {});
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" }, { instructions: INSTRUCTIONS });

  async function callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    const trace = new RunTrace(randomUUID());
    const span = trace.start(name, "tool", { input: args, target });
    const query = typeof args.query === "string" ? args.query : "";
    const result = await executeTool(name, JSON.stringify(args), {
      target,
      signal,
      span,
      language: name === KNOWLEDGE_TOOL_NAME && query ? detectReplyLanguage(query) : undefined,
    });
    if (result.ok) span.end({ output: result.content ?? result.data });
    else span.fail(new Error(`${result.kind}: ${result.error}`));
    trace.close();

    const stages = stageTimings(trace.spans);
    log(
      `${name} ${result.ok ? "ok" : `failed (${result.kind})`} ${span.data.endedAt! - span.data.startedAt}ms target=${target}` +
        (result.ok && result.sources ? ` sources=${[...new Set(result.sources.map((s) => s.docId))].join(",") || "none"}` : "") +
        (stages ? ` [${stages}]` : ""),
    );

    if (!result.ok) {
      return { isError: true, content: [{ type: "text", text: capPayload(`${result.kind}: ${result.error}`) }] };
    }
    const text = result.content ?? JSON.stringify(result.data, null, 2);
    return { content: [{ type: "text", text: capPayload(text) }] };
  }

  for (const def of listToolDefinitions()) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: z.fromJSONSchema(def.parameters),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (args, extra) => callTool(def.name, (args ?? {}) as Record<string, unknown>, extra.signal),
    );
  }

  server.registerResource(
    "fab-knowledge-doc",
    new ResourceTemplate(`${KB_RESOURCE_PREFIX}{docId}`, {
      list: () => ({
        resources: loadCorpus().docs.map((doc) => ({
          uri: `${KB_RESOURCE_PREFIX}${doc.id}`,
          name: doc.id,
          title: doc.title,
          description: [doc.type, ...doc.codes].join(" · "),
          mimeType: "text/markdown",
        })),
      }),
      complete: {
        docId: (value) =>
          loadCorpus()
            .docs.map((d) => d.id)
            .filter((id) => id.toLowerCase().startsWith(value.toLowerCase())),
      },
    }),
    {
      title: "Fab knowledge base document",
      description: "A full runbook, SOP, incident report or equipment spec, in its source language.",
      mimeType: "text/markdown",
    },
    (uri, { docId }) => {
      const id = Array.isArray(docId) ? docId[0] : docId;
      const doc = loadCorpus().docs.find((d) => d.id === id);
      if (!doc) throw new Error(`Unknown knowledge document: ${id}`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderKbDoc(doc) }] };
    },
  );

  return server;
}
