/**
 * search_fab_knowledge: retrieval over the fab knowledge base (runbooks, SOPs, incident
 * reports, specs) as an agent tool. The model writes the search query and may set metadata
 * filters (self-query); the passages come back with document IDs the plan can cite, and
 * the grounding checks verify those citations against what was actually retrieved.
 */
import { KB_DOC_TYPES, type KbDocType, type KbLang } from "@/lib/rag/corpus";
import { localizeHits, retrieve, type KbFilter, type RetrievalResult } from "@/lib/rag/retrieve";
import { getCloudModel, isCloudConfigured, isLocalAiRuntime } from "../router";
import type { Span, UsageCallback } from "../trace";
import type { AiRouteTarget, KnowledgeSource } from "../types";
import type { ToolDefinition } from "./types";

export const KNOWLEDGE_TOOL_NAME = "search_fab_knowledge";
const MAX_QUERY_CHARS = 300;
const ALERT_CODE = /^[A-Z]{2,}(?:-[A-Z]{2,})+$/;

export function isKnowledgeEnabled(): boolean {
  return process.env.AI_RAG?.trim().toLowerCase() !== "off";
}

export function isRerankEnabled(): boolean {
  return process.env.AI_RAG_RERANK?.trim().toLowerCase() !== "off";
}

export const KNOWLEDGE_TOOL_DEFINITION: ToolDefinition = {
  name: KNOWLEDGE_TOOL_NAME,
  description:
    "Search the fab knowledge base: alert runbooks (how to handle an alert code), SOPs (procedures, release criteria), past incident reports (root causes, lessons learned) and equipment specs (limits, PM intervals). Returns passages with document IDs to cite.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query: the alert code or symptom plus the user's actual concern, in the user's words where possible (e.g. 'ETCH-RF-DRIFT 告警已确认 还需要处理吗', 'ETCH-PARTICLE 颗粒超标 处置步骤'). Do not reduce the question to a generic 'handling procedure'.",
      },
      docType: {
        type: "string",
        enum: [...KB_DOC_TYPES],
        description:
          "Optional: only runbook / sop / incident / spec documents. Set it only when the user asks for that kind of document; a filter hides related incidents and specs.",
      },
      alertCode: {
        type: "string",
        description: "Optional: only documents about this alert code, e.g. ETCH-RF-DRIFT.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export type ToolContext = {
  target: AiRouteTarget;
  signal: AbortSignal;
  /** The tool span; retrieval stages become its children. */
  span: Span;
  onUsage?: UsageCallback;
  /** Language of the user's question; passages are returned in it where a translation exists. */
  language?: KbLang;
};

export type KnowledgeToolResult =
  | { ok: true; data: unknown; content: string; sources: KnowledgeSource[] }
  | { ok: false; kind: "invalid_args" | "internal"; error: string };

/** Model-facing text: numbered passages headed by the document ID to cite. */
export function renderKnowledge(result: RetrievalResult): string {
  const how = [
    result.mode === "hybrid" ? "hybrid BM25 + vector" : result.mode,
    result.rerankModel ? "reranked" : null,
    result.filterRelaxed ? "filter relaxed" : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (result.hits.length === 0) {
    return `Knowledge search "${result.query}" (${how}): no relevant document. Do not cite any document for this.`;
  }
  const passages = result.hits.map(
    (h, i) => `[${i + 1}] ${h.docId} · ${h.docTitle} › ${h.heading}\n${h.text}`,
  );
  const caveat = result.rerankModel
    ? ""
    : " Passages are ranked by similarity and may not answer the question: use only those that directly address it, and if none does, say the knowledge base has no applicable document instead of applying a procedure written for a different alarm or equipment.";
  return `Knowledge search "${result.query}" (${how}). Cite the document ID (e.g. ${result.hits[0].docId}) in refs when you use a passage.${caveat}\n\n${passages.join("\n\n")}`;
}

function parseArgs(argsJson: string): { query: string; filter: KbFilter } | { error: string } {
  let args: Record<string, unknown> = {};
  try {
    const parsed = argsJson.trim() ? (JSON.parse(argsJson) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return { error: `Invalid JSON arguments: ${argsJson.slice(0, 200)}` };
  }
  const query = typeof args.query === "string" ? args.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  if (!query) return { error: "query is required" };
  const filter: KbFilter = {};
  if (typeof args.docType === "string" && (KB_DOC_TYPES as readonly string[]).includes(args.docType)) {
    filter.docType = args.docType as KbDocType;
  }
  const code = typeof args.alertCode === "string" ? args.alertCode.trim().toUpperCase() : "";
  if (ALERT_CODE.test(code)) filter.alertCode = code;
  return { query, filter };
}

export async function executeKnowledgeTool(
  argsJson: string,
  ctx: ToolContext,
): Promise<KnowledgeToolResult> {
  const args = parseArgs(argsJson);
  if ("error" in args) return { ok: false, kind: "invalid_args", error: args.error };
  const cloud = isCloudConfigured();
  try {
    const retrieved = await retrieve({
      query: args.query,
      filter: args.filter,
      // Local runs keep the query on the machine: vectors from Ollama or BM25 only.
      embed: { localRuntime: isLocalAiRuntime(), cloudAvailable: cloud && ctx.target === "cloud" },
      rerankModel: ctx.target === "cloud" && cloud && isRerankEnabled() ? getCloudModel() : null,
      signal: ctx.signal,
      span: ctx.span,
      onUsage: ctx.onUsage,
    });
    const result = ctx.language ? { ...retrieved, hits: localizeHits(retrieved.hits, ctx.language) } : retrieved;
    return {
      ok: true,
      data: {
        query: result.query,
        mode: result.mode,
        results: result.hits.map((h) => ({ docId: h.docId, section: h.heading, text: h.text })),
      },
      content: renderKnowledge(result),
      sources: result.hits.map((h) => ({
        docId: h.docId,
        title: h.docTitle,
        heading: h.heading,
        relevance: h.relevance,
        matchedBy: h.matchedBy,
      })),
    };
  } catch (err) {
    return { ok: false, kind: "internal", error: err instanceof Error ? err.message : String(err) };
  }
}
