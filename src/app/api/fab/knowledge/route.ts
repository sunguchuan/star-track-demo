import { checkRateLimit, clientKeyFromRequest } from "@/lib/ai/guardrails/resource";
import { detectReplyLanguage } from "@/lib/ai/language";
import { getCloudModel, isCloudConfigured, isLocalAiRuntime } from "@/lib/ai/router";
import { isRerankEnabled } from "@/lib/ai/tools/knowledge";
import { KB_DOC_TYPES, KB_LANGS, loadCorpus, localizeSection, type KbDocType, type KbLang } from "@/lib/rag/corpus";
import { localizeHits, MIN_RELEVANCE, retrieve, type RankedSection } from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CHARS = 300;
const ALERT_CODE = /^[A-Z][A-Z0-9-]{1,39}$/;

/** GET /api/fab/knowledge — corpus overview */
export async function GET() {
  try {
    const corpus = loadCorpus();
    return Response.json({
      version: corpus.version,
      sections: corpus.sections.size,
      chunks: corpus.chunks.length,
      docs: corpus.docs.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        codes: d.codes,
        sections: d.sections.map((s) => s.heading),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the knowledge base";
    return Response.json({ error: message }, { status: 500 });
  }
}

type SearchBody = { query?: unknown; docType?: unknown; alertCode?: unknown; rerank?: unknown; language?: unknown };

/**
 * POST /api/fab/knowledge { query, docType?, alertCode?, rerank?, language? } — runs the same
 * hybrid retrieval as the agent's search_fab_knowledge tool and returns every stage's ranking.
 * Headings and passages come back in the query's language (or `language`) where translated.
 */
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFromRequest(request));
  if (!limit.ok) {
    return Response.json(
      { error: `Rate limit: ${limit.limit} requests per minute` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > MAX_QUERY_CHARS) {
    return Response.json({ error: `query must be 1–${MAX_QUERY_CHARS} characters` }, { status: 400 });
  }
  const docType =
    typeof body.docType === "string" && (KB_DOC_TYPES as readonly string[]).includes(body.docType)
      ? (body.docType as KbDocType)
      : undefined;
  const alertCode =
    typeof body.alertCode === "string" && ALERT_CODE.test(body.alertCode.trim())
      ? body.alertCode.trim()
      : undefined;
  const language: KbLang = (KB_LANGS as readonly unknown[]).includes(body.language)
    ? (body.language as KbLang)
    : detectReplyLanguage(query);
  const cloud = isCloudConfigured();
  const wantRerank = body.rerank !== false && isRerankEnabled() && cloud;

  try {
    const corpus = loadCorpus();
    const result = await retrieve({
      query,
      filter: { docType, alertCode },
      topK: 3,
      embed: { localRuntime: isLocalAiRuntime(), cloudAvailable: cloud },
      rerankModel: wantRerank ? getCloudModel() : null,
      signal: request.signal,
      corpus,
    });
    const label = (stage: RankedSection[] | null) =>
      stage?.map((r) => {
        const s = corpus.sections.get(r.sectionId)!;
        const { heading } = localizeSection(corpus, s, language);
        return { sectionId: r.sectionId, docId: s.docId, heading, score: r.score };
      }) ?? null;

    return Response.json({
      query: result.query,
      language,
      filter: result.filter,
      filterRelaxed: result.filterRelaxed,
      mode: result.mode,
      embedModel: result.embedModel,
      vectorError: result.vectorError,
      rerankModel: result.rerankModel,
      rerankError: result.rerankError,
      similarityFloor: result.similarityFloor,
      minRelevance: MIN_RELEVANCE,
      stages: {
        bm25: label(result.stages.bm25),
        vector: label(result.stages.vector),
        fused: label(result.stages.fused),
        rerank: label(result.stages.rerank),
      },
      hits: localizeHits(result.hits, language, corpus),
      ms: result.ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
