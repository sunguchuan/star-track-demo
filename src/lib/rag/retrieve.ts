/**
 * Hybrid retrieval over the fab knowledge base:
 *
 *   query ─┬─ BM25 over child chunks ───┐
 *          └─ embed → cosine over chunks ┴─ max-pool to sections ─ RRF ─ LLM rerank ─ top-K sections
 *
 * - Metadata filter (doc type / alert code / tool) narrows the candidates first and is
 *   relaxed when nothing matches, so a wrong filter cannot hide every document.
 * - Children are matched, parents (sections) are returned (see corpus.ts).
 * - Reciprocal Rank Fusion merges rankings without calibrating BM25 against cosine scores.
 * - The reranker's 0–3 relevance drops weak passages, so "no relevant document" is possible;
 *   without it (local runs, rerank error / timeout) a per-model similarity floor does that job.
 * - Without embeddings (no Ollama, no cloud key) it degrades to BM25 only.
 * Every stage is a span in the run trace.
 */
import { randomUUID } from "crypto";
import {
  cosine,
  embedDocuments,
  embeddingCostUsd,
  embedText,
  type Embedding,
} from "@/lib/ai/embeddings";
import { toProviderError } from "@/lib/ai/errors";
import { hedged } from "@/lib/ai/hedge";
import { RunTrace, type Span, type UsageCallback } from "@/lib/ai/trace";
import { Bm25Index } from "./bm25";
import {
  loadCorpus,
  localizeSection,
  type KbCorpus,
  type KbDocType,
  type KbLang,
  type KbSection,
} from "./corpus";
import { rerankSections } from "./rerank";
import { loadVectors, saveVectors } from "./vector-store";

export const RRF_K = 60;
/**
 * Share of the query's tokens a chunk must contain to count as a BM25 match. Without it, a
 * paraphrased or cross-lingual query still "matches" sections through one generic word, and
 * RRF promotes those sections because they appear in both lists (eval:rag: hybrid Recall@3
 * 77% → 96% at 0.3; swept 0 / 0.2 / 0.3 / 0.4 on the same small query set).
 */
export const BM25_MIN_SHOULD_MATCH = 0.3;
/** Child chunks taken from each retriever before pooling into sections. */
export const CHILD_CANDIDATES = 30;
export const SECTION_CANDIDATES = 10;
export const RERANK_CANDIDATES = 8;
/** Usually 1–3 s; past this the fused ranking is used instead of stalling the agent. */
export const RERANK_TIMEOUT_MS = 10_000;
/** A rerank call still running after this is duplicated (hedged); the first reply wins. */
export const RERANK_HEDGE_AFTER_MS = 4_000;
/** Reranker scale: 3 answers, 2 partly answers / needed context, 1 same topic only, 0 unrelated. */
export const MIN_RELEVANCE = 2;
export const DEFAULT_TOP_K = 3;
/**
 * Without the reranker there is no relevance score, only similarity, so a fused section is kept
 * when BM25 matched it (minShouldMatch already demands real term overlap) or its cosine clears
 * the embedding model's floor. Cosine is not comparable across models, and in-domain questions
 * the corpus does not answer score as high as some answerable ones (eval:rag with embeddinggemma:
 * unanswerable ≤ 0.44, answerable with no term overlap ≥ 0.47; gemini-embedding-001 overlaps
 * outright), so floors exist only where they were calibrated. The reranker is the real gate.
 */
export const VECTOR_MIN_SIMILARITY: Record<string, number> = { embeddinggemma: 0.45 };

export function similarityFloor(model: string | null): number | null {
  if (!model) return null;
  return VECTOR_MIN_SIMILARITY[model.split(":")[0]] ?? null;
}

export type RetrievalMode = "bm25" | "vector" | "hybrid";
export type Retriever = "bm25" | "vector";

export type KbFilter = { docType?: KbDocType; alertCode?: string; toolId?: string };

export type RankedSection = { sectionId: string; score: number };

export type KbHit = {
  sectionId: string;
  docId: string;
  docTitle: string;
  heading: string;
  type: KbDocType;
  text: string;
  /** Retrievers that had this section among their candidates. */
  matchedBy: Retriever[];
  fusedRank: number;
  /** Reranker score (0–3), null when not reranked. */
  relevance: number | null;
};

export type RetrievalResult = {
  query: string;
  filter: KbFilter;
  /** The filter matched no document and was dropped. */
  filterRelaxed: boolean;
  requestedMode: RetrievalMode;
  /** hybrid / vector fall back to bm25 when embedding fails. */
  mode: RetrievalMode;
  embedModel: string | null;
  vectorError: string | null;
  rerankModel: string | null;
  rerankError: string | null;
  /** Cosine floor applied to vector-only sections when not reranked; null when none applied. */
  similarityFloor: number | null;
  stages: {
    bm25: RankedSection[];
    vector: RankedSection[];
    fused: RankedSection[];
    /** Candidates in reranked order with their 0–3 scores (before the relevance cut). */
    rerank: RankedSection[] | null;
  };
  hits: KbHit[];
  ms: number;
};

export type RetrievalOptions = {
  query: string;
  filter?: KbFilter;
  mode?: RetrievalMode;
  topK?: number;
  /** Where query / chunk vectors may come from; local is tried first. */
  embed: { localRuntime: boolean; cloudAvailable: boolean };
  /** Cloud model for the reranker; null / undefined skips reranking. */
  rerankModel?: string | null;
  signal?: AbortSignal;
  span?: Span;
  onUsage?: UsageCallback;
  corpus?: KbCorpus;
};

export function matchesFilter(section: KbSection, filter: KbFilter): boolean {
  if (filter.docType && section.type !== filter.docType) return false;
  if (filter.alertCode && !section.codes.includes(filter.alertCode)) return false;
  if (filter.toolId && !section.tools.includes(filter.toolId)) return false;
  return true;
}

const hasFilter = (f: KbFilter) => Boolean(f.docType || f.alertCode || f.toolId);

/** Max-pooling: a section ranks where its best child ranks. */
export function poolSections(
  chunkHits: { chunkId: string; score: number }[],
  sectionOf: (chunkId: string) => string,
  limit = SECTION_CANDIDATES,
): RankedSection[] {
  const seen = new Set<string>();
  const out: RankedSection[] = [];
  for (const hit of chunkHits) {
    const sectionId = sectionOf(hit.chunkId);
    if (seen.has(sectionId)) continue;
    seen.add(sectionId);
    out.push({ sectionId, score: hit.score });
    if (out.length >= limit) break;
  }
  return out;
}

/** Reciprocal Rank Fusion: Σ 1 / (k + rank) over the lists a section appears in. */
export function reciprocalRankFusion(lists: RankedSection[][], k = RRF_K): RankedSection[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => {
      scores.set(item.sectionId, (scores.get(item.sectionId) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores]
    .map(([sectionId, score]) => ({ sectionId, score }))
    .sort((a, b) => b.score - a.score);
}

const round = (n: number, digits = 4) => Number(n.toFixed(digits));
const brief = (list: RankedSection[], n = 5) =>
  list.slice(0, n).map((s) => `${s.sectionId} (${round(s.score)})`);

let bm25Cache: { version: string; index: Bm25Index } | null = null;

function bm25For(corpus: KbCorpus): Bm25Index {
  if (bm25Cache?.version === corpus.version) return bm25Cache.index;
  const index = new Bm25Index(corpus.chunks.map((c) => ({ id: c.id, text: `${c.header}\n${c.text}` })));
  bm25Cache = { version: corpus.version, index };
  return index;
}

const vectorCache = new Map<string, Map<string, Float32Array>>();

/**
 * Chunk vectors for the query's embedding model: memory → SQLite → embed the missing ones
 * (a `rag.index` span, first request after a deploy or a document edit).
 */
async function chunkVectors(
  corpus: KbCorpus,
  query: Embedding,
  parent: Span,
  signal?: AbortSignal,
): Promise<Map<string, Float32Array>> {
  const key = `${corpus.version}:${query.model}`;
  const hit = vectorCache.get(key);
  if (hit) return hit;

  const stored = loadVectors(query.model);
  const missing = corpus.chunks.filter((c) => !stored.has(c.hash));
  if (missing.length > 0) {
    const span = parent.child("rag.index", "embedding", {
      target: query.target,
      model: query.model,
      metadata: { chunks: corpus.chunks.length, embedding: missing.length },
    });
    try {
      const result = await embedDocuments({
        inputs: missing.map((c) => ({ title: c.header, text: c.text })),
        target: query.target,
        signal,
      });
      if (result.model !== query.model) throw new Error(`embedding model changed: ${result.model}`);
      const entries = missing.map((c, i) => ({ hash: c.hash, vector: result.vectors[i] }));
      saveVectors(result.model, entries);
      for (const e of entries) stored.set(e.hash, e.vector);
      span.setUsage(
        { promptTokens: result.promptTokens, completionTokens: 0 },
        embeddingCostUsd(result.target, result.promptTokens),
      );
      span.end({ metadata: { dims: result.vectors[0]?.length ?? null } });
    } catch (err) {
      span.fail(err);
      throw err;
    }
  }

  const byChunk = new Map<string, Float32Array>();
  for (const c of corpus.chunks) {
    const v = stored.get(c.hash);
    if (v) byChunk.set(c.id, v);
  }
  vectorCache.set(key, byChunk);
  return byChunk;
}

async function embedQuery(
  parent: Span,
  query: string,
  embed: RetrievalOptions["embed"],
  signal?: AbortSignal,
): Promise<Embedding> {
  const span = parent.child("embed", "embedding", { input: query, metadata: { purpose: "query" } });
  try {
    const embedding = await embedText({ text: query, purpose: "query", ...embed, signal });
    const tokens = embedding.promptTokens ?? 0;
    span.update({ model: embedding.model, target: embedding.target });
    span.setUsage({ promptTokens: tokens, completionTokens: 0 }, embeddingCostUsd(embedding.target, tokens));
    span.end({ metadata: { dims: embedding.vector.length } });
    return embedding;
  } catch (err) {
    span.fail(err);
    throw err;
  }
}

export async function retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
  const startedAt = Date.now();
  const corpus = options.corpus ?? loadCorpus();
  const requestedMode = options.mode ?? "hybrid";
  const topK = options.topK ?? DEFAULT_TOP_K;
  const query = options.query.trim();
  const parent = options.span ?? new RunTrace(randomUUID()).start("rag", "agent");
  const root = parent.child("rag.retrieve", "retriever", {
    input: query,
    metadata: { mode: requestedMode, filter: options.filter ?? {}, chunks: corpus.chunks.length },
  });

  let filter: KbFilter = { ...options.filter };
  let filterRelaxed = false;
  const sections = [...corpus.sections.values()];
  if (hasFilter(filter) && !sections.some((s) => matchesFilter(s, filter))) {
    filter = {};
    filterRelaxed = true;
  }
  const allowed = new Set(sections.filter((s) => matchesFilter(s, filter)).map((s) => s.id));
  const sectionOf = (chunkId: string) => chunkId.slice(0, chunkId.lastIndexOf(":"));
  const chunkAllowed = (chunkId: string) => allowed.has(sectionOf(chunkId));

  // BM25 always runs: it is cheap, and it is the fallback when vectors are unavailable.
  const bm25Span = root.child("rag.bm25", "span", { input: query });
  const bm25Hits = bm25For(corpus).search(query, CHILD_CANDIDATES, chunkAllowed, BM25_MIN_SHOULD_MATCH);
  const bm25 = poolSections(
    bm25Hits.map((h) => ({ chunkId: h.id, score: h.score })),
    sectionOf,
  );
  bm25Span.end({ output: brief(bm25), metadata: { chunkHits: bm25Hits.length } });

  let vector: RankedSection[] = [];
  let embedModel: string | null = null;
  let vectorError: string | null = null;
  if (requestedMode !== "bm25") {
    try {
      const q = await embedQuery(root, query, options.embed, options.signal);
      embedModel = q.model;
      const vectors = await chunkVectors(corpus, q, root, options.signal);
      const span = root.child("rag.vector", "span", { model: q.model, target: q.target });
      const scored: { chunkId: string; score: number }[] = [];
      for (const [chunkId, v] of vectors) {
        if (chunkAllowed(chunkId)) scored.push({ chunkId, score: cosine(q.vector, v) });
      }
      scored.sort((a, b) => b.score - a.score);
      vector = poolSections(scored.slice(0, CHILD_CANDIDATES), sectionOf);
      span.end({ output: brief(vector), metadata: { chunksScored: scored.length } });
    } catch (err) {
      vectorError = toProviderError(err, options.embed.localRuntime ? "local" : "cloud").message;
    }
  }

  const mode: RetrievalMode = vectorError ? "bm25" : requestedMode;
  let fused: RankedSection[];
  if (mode === "hybrid") {
    const span = root.child("rag.fuse", "span", { metadata: { method: "rrf", k: RRF_K } });
    fused = reciprocalRankFusion([bm25, vector]).slice(0, SECTION_CANDIDATES);
    span.end({ output: brief(fused) });
  } else {
    fused = mode === "vector" ? vector : bm25;
  }

  let rerank: RankedSection[] | null = null;
  let rerankError: string | null = null;
  const rerankModel = options.rerankModel || null;
  if (rerankModel && fused.length > 0) {
    const candidates = fused.slice(0, RERANK_CANDIDATES);
    const span = root.child("rag.rerank", "generation", {
      target: "cloud",
      model: rerankModel,
      input: query,
      metadata: { candidates: candidates.length, minRelevance: MIN_RELEVANCE },
    });
    const timeout = AbortSignal.timeout(RERANK_TIMEOUT_MS);
    const sections = candidates.map((c) => corpus.sections.get(c.sectionId)!);
    const onUsage = span.usageSink(options.onUsage);
    try {
      const { value: scores, attempts, winner } = await hedged(
        (signal) => rerankSections({ query, sections, model: rerankModel, signal, onUsage }),
        {
          hedgeAfterMs: RERANK_HEDGE_AFTER_MS,
          signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
          retryIf: (err) => {
            const { code } = toProviderError(err, "cloud");
            return code !== "quota_exhausted" && code !== "rate_limited";
          },
        },
      );
      rerank = candidates
        .map((c, i) => ({ sectionId: c.sectionId, score: scores[i], i }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map(({ sectionId, score }) => ({ sectionId, score }));
      span.end({
        output: rerank.map((r) => `${r.sectionId} (${r.score})`),
        metadata: { attempts, winner },
      });
    } catch (err) {
      span.fail(err);
      if (options.signal?.aborted) throw err;
      rerankError = timeout.aborted
        ? `rerank timed out after ${RERANK_TIMEOUT_MS / 1000} s`
        : toProviderError(err, "cloud").message;
    }
  }

  const inBm25 = new Set(bm25.map((s) => s.sectionId));
  const inVector = new Set(vector.map((s) => s.sectionId));
  const floor = !rerank && mode !== "bm25" ? similarityFloor(embedModel) : null;
  const cosineOf = new Map(vector.map((s) => [s.sectionId, s.score]));
  const final = rerank
    ? rerank.filter((r) => r.score >= MIN_RELEVANCE).slice(0, topK)
    : fused
        .filter((r) => floor == null || inBm25.has(r.sectionId) || (cosineOf.get(r.sectionId) ?? 0) >= floor)
        .slice(0, topK);
  const hits: KbHit[] = final.map((r) => {
    const s = corpus.sections.get(r.sectionId)!;
    return {
      sectionId: s.id,
      docId: s.docId,
      docTitle: s.docTitle,
      heading: s.heading,
      type: s.type,
      text: s.text,
      matchedBy: [
        ...(inBm25.has(s.id) ? (["bm25"] as const) : []),
        ...(inVector.has(s.id) ? (["vector"] as const) : []),
      ],
      fusedRank: fused.findIndex((f) => f.sectionId === s.id) + 1,
      relevance: rerank ? r.score : null,
    };
  });

  const result: RetrievalResult = {
    query,
    filter,
    filterRelaxed,
    requestedMode,
    mode,
    embedModel,
    vectorError,
    rerankModel: rerank ? rerankModel : null,
    rerankError,
    similarityFloor: floor,
    stages: { bm25, vector, fused, rerank },
    hits,
    ms: Date.now() - startedAt,
  };
  root.end({
    output: hits.map((h) => h.sectionId),
    status: vectorError || rerankError ? "warning" : "ok",
    statusMessage: vectorError ? `vector search unavailable: ${vectorError}` : (rerankError ?? undefined),
    metadata: {
      mode,
      embedModel,
      filter,
      filterRelaxed,
      reranked: rerank != null,
      similarityFloor: floor,
      abstained: hits.length === 0,
    },
  });
  return result;
}

export function getCorpusVersion(): string {
  return loadCorpus().version;
}

export type LocalizedHit = KbHit & { translated: boolean };

/** Hits shown in `lang`: translated title, heading and text where a translation exists. */
export function localizeHits(hits: KbHit[], lang: KbLang, corpus: KbCorpus = loadCorpus()): LocalizedHit[] {
  return hits.map((hit) => {
    const section = corpus.sections.get(hit.sectionId);
    return section ? { ...hit, ...localizeSection(corpus, section, lang) } : { ...hit, translated: false };
  });
}
