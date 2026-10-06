/**
 * Answer cache for the Gateway (table ai_cache in ai-runs.db).
 *
 * - exact mode: same task + input + history → same answer (rewrite tasks).
 * - semantic mode: embed the question, compare with past questions in the same partition
 *   (task, reply language, data version) and embedding model, and serve the closest one
 *   above the model's threshold whose key terms match (cache-keys.ts).
 *
 * Every lookup / store is a span in the run trace; failures degrade to a miss.
 */
import { randomUUID } from "crypto";
import type { ActionPlan } from "./action-plan";
import {
  decideHit,
  similarityThreshold,
  type CacheContext,
  type CacheMode,
} from "./cache-keys";
import { cosine, embeddingCostUsd, embedText, type Embedding } from "./embeddings";
import { redactSensitive } from "./guardrails/input";
import { getRunCacheEntryId, getRunsDb } from "./runs";
import type { Span } from "./trace";
import type { AiRouteTarget } from "./types";

export const MAX_CACHE_ENTRIES = 2000;
const DEFAULT_TTL_HOURS = 24;

export function isCacheEnabled(): boolean {
  return process.env.AI_CACHE?.trim().toLowerCase() !== "off";
}

export function cacheTtlMs(): number {
  const hours = Number(process.env.AI_CACHE_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3_600_000;
}

export type CachedPlan = { plan: ActionPlan; ungroundedRefs: string[] };

export type CachedAnswer = {
  id: string;
  mode: CacheMode;
  similarity: number | null;
  target: AiRouteTarget;
  model: string;
  output: string;
  plan: CachedPlan | null;
  sourceRunId: string;
  sourceMs: number;
  sourceCostUsd: number;
  createdAt: number;
};

type EntryRow = {
  id: string;
  mode: string;
  target: string;
  model: string;
  output: string;
  plan: string | null;
  source_run_id: string;
  source_ms: number;
  source_cost_usd: number;
  created_at: number;
};

type VectorRow = {
  id: string;
  target: string;
  terms: string;
  embedding: Uint8Array;
};

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** Copy first: SQLite blobs are not guaranteed to be 4-byte aligned. */
function fromBlob(blob: Uint8Array): Float32Array {
  const copy = blob.slice();
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

function parsePlan(raw: string | null): CachedPlan | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedPlan;
  } catch {
    return null;
  }
}

function toAnswer(row: EntryRow, similarity: number | null): CachedAnswer {
  return {
    id: row.id,
    mode: row.mode as CacheMode,
    similarity,
    target: row.target as AiRouteTarget,
    model: row.model,
    output: row.output,
    plan: parsePlan(row.plan),
    sourceRunId: row.source_run_id,
    sourceMs: row.source_ms,
    sourceCostUsd: row.source_cost_usd,
    createdAt: row.created_at,
  };
}

async function embedWithSpan(
  parent: Span,
  text: string,
  options: { localRuntime: boolean; cloudAvailable: boolean; signal: AbortSignal },
): Promise<Embedding> {
  const span = parent.child("embed", "embedding", { input: text });
  try {
    const embedding = await embedText({ text, ...options });
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

function markHit(id: string): void {
  getRunsDb()
    .prepare("UPDATE ai_cache SET hits = hits + 1, last_hit_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

function loadEntry(id: string): EntryRow | undefined {
  return getRunsDb().prepare("SELECT * FROM ai_cache WHERE id = ?").get(id) as EntryRow | undefined;
}

function semanticCandidates(context: CacheContext, embedding: Embedding) {
  const rows = getRunsDb()
    .prepare(
      `SELECT id, target, terms, embedding FROM ai_cache
       WHERE mode = 'semantic' AND partition_key = ? AND embed_model = ? AND expires_at > ?`,
    )
    .all(context.partition, embedding.model, Date.now()) as VectorRow[];
  return rows.map((row) => ({
    id: row.id,
    target: row.target as AiRouteTarget,
    terms: row.terms,
    similarity: cosine(embedding.vector, fromBlob(row.embedding)),
  }));
}

export type CacheLookup = {
  hit: CachedAnswer | null;
  /** Reused to store the answer on a miss (semantic mode only). */
  embedding: Embedding | null;
};

/**
 * `bypass` (the user asked to regenerate) skips the lookup but still embeds, so the fresh
 * answer can replace the stale one.
 */
export async function lookupAnswer(options: {
  context: CacheContext;
  input: string;
  bypass: boolean;
  localRuntime: boolean;
  cloudAvailable: boolean;
  signal: AbortSignal;
  parent: Span;
}): Promise<CacheLookup> {
  const { context } = options;
  const span = options.parent.child("cache.lookup", "retriever", {
    input: options.input,
    metadata: {
      mode: context.mode,
      partition: context.partition,
      terms: context.terms,
      bypass: options.bypass,
    },
  });

  try {
    if (context.mode === "exact") {
      if (options.bypass) {
        span.end({ metadata: { outcome: "bypass" } });
        return { hit: null, embedding: null };
      }
      const row = (
        getRunsDb()
          .prepare(
            `SELECT * FROM ai_cache WHERE exact_key = ? AND partition_key = ? AND expires_at > ?
             ORDER BY created_at DESC`,
          )
          .all(context.exactKey, context.partition, Date.now()) as EntryRow[]
      ).find((r) => context.allowed.includes(r.target as AiRouteTarget));
      if (!row) {
        span.end({ metadata: { outcome: "miss" } });
        return { hit: null, embedding: null };
      }
      markHit(row.id);
      span.end({ output: { entryId: row.id }, metadata: { outcome: "hit" } });
      return { hit: toAnswer(row, null), embedding: null };
    }

    const embedding = await embedWithSpan(span, options.input, options);
    if (options.bypass) {
      span.end({ metadata: { outcome: "bypass", embedModel: embedding.model } });
      return { hit: null, embedding };
    }
    const threshold = similarityThreshold(embedding.model);
    const candidates = semanticCandidates(context, embedding);
    const decision = decideHit(candidates, context, threshold);
    const row = decision.hit ? loadEntry(decision.hit.id) : undefined;
    const metadata = {
      outcome: row ? "hit" : "miss",
      embedModel: embedding.model,
      threshold,
      candidates: candidates.length,
      bestSimilarity: decision.best ? Number(decision.best.similarity.toFixed(4)) : null,
      bestTermsMatch: decision.best?.termsMatch ?? null,
      rejectedByTerms: decision.rejectedByTerms,
    };
    if (!row || !decision.hit) {
      span.end({ metadata });
      return { hit: null, embedding };
    }
    markHit(row.id);
    span.end({ output: { entryId: row.id, similarity: metadata.bestSimilarity }, metadata });
    return { hit: toAnswer(row, decision.hit.similarity), embedding };
  } catch (err) {
    span.fail(err, { metadata: { outcome: "error" } });
    return { hit: null, embedding: null };
  }
}

export function rememberAnswer(options: {
  context: CacheContext;
  embedding: Embedding | null;
  input: string;
  target: AiRouteTarget;
  model: string;
  output: string;
  plan: CachedPlan | null;
  sourceRunId: string;
  sourceMs: number;
  sourceCostUsd: number;
  /** Regenerated answer: drop the entries the old lookup would have matched. */
  replaceSimilar: boolean;
  parent: Span;
}): void {
  const { context, embedding } = options;
  const span = options.parent.child("cache.store", "span", {
    metadata: { mode: context.mode, partition: context.partition },
  });
  if (context.mode === "semantic" && !embedding) {
    span.end({ status: "warning", statusMessage: "no embedding (embedding failed)" });
    return;
  }

  const db = getRunsDb();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    let replaced = 0;
    if (context.mode === "exact") {
      replaced += Number(
        db
          .prepare("DELETE FROM ai_cache WHERE exact_key = ? AND partition_key = ?")
          .run(context.exactKey, context.partition).changes,
      );
    } else if (options.replaceSimilar && embedding) {
      const threshold = similarityThreshold(embedding.model);
      const remove = db.prepare("DELETE FROM ai_cache WHERE id = ?");
      for (const c of semanticCandidates(context, embedding)) {
        if (c.similarity >= threshold && c.terms === context.terms) {
          replaced += Number(remove.run(c.id).changes);
        }
      }
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO ai_cache
        (id, mode, partition_key, exact_key, terms, embed_model, embedding, task_type, input,
         target, model, output, plan, source_run_id, source_ms, source_cost_usd, created_at,
         expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      context.mode,
      context.partition,
      context.exactKey,
      context.terms,
      embedding?.model ?? null,
      embedding ? toBlob(embedding.vector) : null,
      context.taskType,
      redactSensitive(options.input).slice(0, 2000),
      options.target,
      options.model,
      options.output,
      options.plan ? JSON.stringify(options.plan) : null,
      options.sourceRunId,
      options.sourceMs,
      options.sourceCostUsd,
      now,
      now + cacheTtlMs(),
    );

    const pruned =
      Number(db.prepare("DELETE FROM ai_cache WHERE expires_at <= ?").run(now).changes) +
      Number(
        db
          .prepare(
            `DELETE FROM ai_cache WHERE id IN (
               SELECT id FROM ai_cache ORDER BY COALESCE(last_hit_at, created_at) DESC
               LIMIT -1 OFFSET ?
             )`,
          )
          .run(MAX_CACHE_ENTRIES).changes,
      );
    db.exec("COMMIT");
    span.end({ output: { entryId: id }, metadata: { replaced, pruned, embedModel: embedding?.model ?? null } });
  } catch (err) {
    db.exec("ROLLBACK");
    span.fail(err);
  }
}

/** Negative feedback: drop answers this run produced or was served from. */
export function evictForRun(runId: string): number {
  const db = getRunsDb();
  const servedFrom = getRunCacheEntryId(runId);
  return Number(
    db
      .prepare("DELETE FROM ai_cache WHERE source_run_id = ? OR id = ?")
      .run(runId, servedFrom ?? "").changes,
  );
}
