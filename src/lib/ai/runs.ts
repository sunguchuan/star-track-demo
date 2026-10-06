/**
 * Run log for the Hybrid AI Gateway: one row per POST /api/ai/chat, plus its span tree
 * (ai_spans) for the per-run trace view.
 * Feeds the /ai/runs observability board (route mix, fallback, latency, tokens/cost, feedback).
 */
import { mkdirSync } from "fs";
import { dirname } from "path";
import { DatabaseSync } from "node:sqlite";
import { dataFilePath } from "@/lib/data-path";
import type { CacheMode } from "./cache-keys";
import type { DifficultyLevel, ModelTier } from "./difficulty";
import type { SpanKind, SpanStatus, TraceSpan } from "./trace";
import type {
  AiRouteTarget,
  AiStrategy,
  AiTaskType,
  GuardrailAction,
  GuardrailStage,
  RunUsage,
} from "./types";

export type AiRunStatus = "ok" | "error" | "aborted" | "blocked";

/** Compact guardrail hit stored per run. */
export type AiRunGuardrail = {
  stage: GuardrailStage;
  rule: string;
  action: GuardrailAction;
};
export type AiRunFeedback = 1 | -1;

export type AiRunRecord = {
  id: string;
  createdAt: string;
  taskType: AiTaskType;
  strategy: AiStrategy;
  initialTarget: AiRouteTarget;
  via: AiRouteTarget;
  model: string;
  reason: string;
  fellBack: boolean;
  status: AiRunStatus;
  errorCode: string | null;
  ttftMs: number | null;
  totalMs: number;
  inputChars: number;
  outputChars: number;
  toolCalls: number;
  guardrails: AiRunGuardrail[];
  /** Null for blocked runs and rows recorded before usage tracking. */
  usage: RunUsage | null;
  feedback: AiRunFeedback | null;
  /** 0 for runs recorded before tracing, or whose spans aged out. */
  spanCount: number;
  /** Set when the answer was served from the cache instead of a model. */
  cache: AiRunCache | null;
  /** Null for rows recorded before difficulty routing. */
  difficulty: DifficultyLevel | null;
  /** Cloud tier that wrote the answer; null for local runs and cache hits. */
  tier: ModelTier | null;
  /** The standard model's plan failed checks and was retried on the strong tier. */
  escalated: boolean;
};

export type AiRunCache = {
  mode: CacheMode;
  /** Null for exact-input hits. */
  similarity: number | null;
  entryId: string;
  /** Original run's total time minus this run's. */
  savedMs: number;
  /** Original run's cloud spend. */
  savedUsd: number;
};

export type CacheStats = {
  hits: number;
  hitRate: number | null;
  savedMs: number;
  savedUsd: number;
  hitTotalP50: number | null;
};

export type TierStats = {
  /** Runs with a difficulty assessment. */
  assessed: number;
  complex: number;
  byTier: Record<
    ModelTier,
    { count: number; costUsd: number; avgCostUsd: number | null; totalP50: number | null }
  >;
  escalated: number;
  /** Escalations where the strong model's plan replaced the standard one. */
  escalationKept: number;
};

export type NewAiRun = Omit<AiRunRecord, "feedback" | "spanCount"> & {
  spans?: TraceSpan[];
};

export type AiRunTrace = {
  run: AiRunRecord;
  spans: TraceSpan[];
};

export type UsageStats = {
  /** Runs that reported token usage. */
  runs: number;
  promptTokens: number;
  completionTokens: number;
  avgTokensPerRun: number | null;
  costUsd: number;
  savedUsd: number;
  /** Share of would-be cloud spend avoided by running locally. */
  savingsRate: number | null;
};

export type LatencyStats = {
  count: number;
  ttftP50: number | null;
  ttftP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
};

export type AiRunStats = {
  total: number;
  localCount: number;
  cloudCount: number;
  fallbackCount: number;
  errorCount: number;
  abortedCount: number;
  blockedCount: number;
  guardrailRunCount: number;
  byGuardrail: (AiRunGuardrail & { count: number })[];
  toolRunCount: number;
  feedbackUp: number;
  feedbackDown: number;
  latency: LatencyStats;
  usage: UsageStats;
  cache: CacheStats;
  tiers: TierStats;
  byVia: Record<AiRouteTarget, LatencyStats & { avgTokens: number | null }>;
  byTask: {
    taskType: AiTaskType;
    count: number;
    errorCount: number;
    avgTokens: number | null;
    costUsd: number;
  }[];
};

type RunRow = {
  id: string;
  created_at: string;
  task_type: string;
  strategy: string;
  initial_target: string;
  via: string;
  model: string;
  reason: string;
  fell_back: number;
  status: string;
  error_code: string | null;
  ttft_ms: number | null;
  total_ms: number;
  input_chars: number;
  output_chars: number;
  tool_calls: number;
  guardrails: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  llm_calls: number | null;
  cost_usd: number | null;
  saved_usd: number | null;
  feedback: number | null;
  cache_mode: string | null;
  cache_similarity: number | null;
  cache_entry_id: string | null;
  cache_saved_ms: number | null;
  cache_saved_usd: number | null;
  difficulty: string | null;
  model_tier: string | null;
  escalated: number | null;
  span_count?: number;
};

type SpanRow = {
  span_id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  started_at: number;
  ended_at: number | null;
  status: string;
  status_message: string | null;
  target: string | null;
  model: string | null;
  input: string | null;
  output: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  first_token_at: number | null;
  metadata: string | null;
};

/** Spans are kept for this many most recent runs; older trees are pruned on insert. */
export const TRACE_RETENTION_RUNS = 1000;

const RUN_SELECT = `SELECT r.*, (SELECT COUNT(*) FROM ai_spans s WHERE s.run_id = r.id) AS span_count
  FROM ai_runs r`;

/** Columns added after the first release; created on startup if missing. */
const ADDED_COLUMNS: [name: string, type: string][] = [
  ["guardrails", "TEXT"],
  ["prompt_tokens", "INTEGER"],
  ["completion_tokens", "INTEGER"],
  ["llm_calls", "INTEGER"],
  ["cost_usd", "REAL"],
  ["saved_usd", "REAL"],
  ["cache_mode", "TEXT"],
  ["cache_similarity", "REAL"],
  ["cache_entry_id", "TEXT"],
  ["cache_saved_ms", "INTEGER"],
  ["cache_saved_usd", "REAL"],
  ["difficulty", "TEXT"],
  ["model_tier", "TEXT"],
  ["escalated", "INTEGER"],
];

const STATS_WINDOW = 500;

let cached: DatabaseSync | null = null;

/** Shared by the run log, span store and answer cache (one SQLite file). */
export function getRunsDb(): DatabaseSync {
  if (cached) return cached;

  const path = dataFilePath("ai-runs.db");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      task_type TEXT NOT NULL,
      strategy TEXT NOT NULL,
      initial_target TEXT NOT NULL,
      via TEXT NOT NULL,
      model TEXT NOT NULL,
      reason TEXT NOT NULL,
      fell_back INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_code TEXT,
      ttft_ms INTEGER,
      total_ms INTEGER NOT NULL,
      input_chars INTEGER NOT NULL,
      output_chars INTEGER NOT NULL,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      feedback INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_runs_created ON ai_runs(created_at DESC);
    CREATE TABLE IF NOT EXISTS ai_spans (
      run_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL,
      status_message TEXT,
      target TEXT,
      model TEXT,
      input TEXT,
      output TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cost_usd REAL,
      first_token_at INTEGER,
      metadata TEXT,
      PRIMARY KEY (run_id, span_id)
    );
    CREATE TABLE IF NOT EXISTS ai_cache (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      partition_key TEXT NOT NULL,
      exact_key TEXT NOT NULL,
      terms TEXT NOT NULL,
      embed_model TEXT,
      embedding BLOB,
      task_type TEXT NOT NULL,
      input TEXT NOT NULL,
      target TEXT NOT NULL,
      model TEXT NOT NULL,
      output TEXT NOT NULL,
      plan TEXT,
      source_run_id TEXT NOT NULL,
      source_ms INTEGER NOT NULL,
      source_cost_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      last_hit_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_cache_partition ON ai_cache(partition_key, embed_model);
    CREATE INDEX IF NOT EXISTS idx_ai_cache_exact ON ai_cache(exact_key);
    CREATE INDEX IF NOT EXISTS idx_ai_cache_source ON ai_cache(source_run_id);
  `);
  const columns = db.prepare("PRAGMA table_info(ai_runs)").all() as {
    name: string;
  }[];
  for (const [name, type] of ADDED_COLUMNS) {
    if (!columns.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE ai_runs ADD COLUMN ${name} ${type}`);
    }
  }
  cached = db;
  return db;
}

function parseGuardrails(raw: string | null): AiRunGuardrail[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AiRunGuardrail[]) : [];
  } catch {
    return [];
  }
}

function mapRun(row: RunRow): AiRunRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    taskType: row.task_type as AiTaskType,
    strategy: row.strategy as AiStrategy,
    initialTarget: row.initial_target as AiRouteTarget,
    via: row.via as AiRouteTarget,
    model: row.model,
    reason: row.reason,
    fellBack: Boolean(row.fell_back),
    status: row.status as AiRunStatus,
    errorCode: row.error_code,
    ttftMs: row.ttft_ms,
    totalMs: row.total_ms,
    inputChars: row.input_chars,
    outputChars: row.output_chars,
    toolCalls: row.tool_calls,
    guardrails: parseGuardrails(row.guardrails),
    usage:
      row.prompt_tokens == null
        ? null
        : {
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens ?? 0,
            calls: row.llm_calls ?? 0,
            costUsd: row.cost_usd ?? 0,
            savedUsd: row.saved_usd ?? 0,
          },
    feedback:
      row.feedback === 1 ? 1 : row.feedback === -1 ? -1 : null,
    spanCount: Number(row.span_count ?? 0),
    cache:
      row.cache_entry_id == null
        ? null
        : {
            mode: row.cache_mode as CacheMode,
            similarity: row.cache_similarity,
            entryId: row.cache_entry_id,
            savedMs: row.cache_saved_ms ?? 0,
            savedUsd: row.cache_saved_usd ?? 0,
          },
    difficulty: row.difficulty === "simple" || row.difficulty === "complex" ? row.difficulty : null,
    tier: row.model_tier === "standard" || row.model_tier === "strong" ? row.model_tier : null,
    escalated: Boolean(row.escalated),
  };
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapSpan(row: SpanRow): TraceSpan {
  return {
    id: row.span_id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind as SpanKind,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as SpanStatus,
    statusMessage: row.status_message,
    target: row.target as AiRouteTarget | null,
    model: row.model,
    input: row.input,
    output: row.output,
    usage:
      row.prompt_tokens == null
        ? null
        : { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens ?? 0 },
    costUsd: row.cost_usd,
    firstTokenAt: row.first_token_at,
    metadata: parseMetadata(row.metadata),
  };
}

function insertSpans(db: DatabaseSync, runId: string, spans: TraceSpan[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ai_spans
      (run_id, span_id, parent_id, name, kind, started_at, ended_at, status, status_message,
       target, model, input, output, prompt_tokens, completion_tokens, cost_usd, first_token_at,
       metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of spans) {
    insert.run(
      runId,
      s.id,
      s.parentId,
      s.name,
      s.kind,
      s.startedAt,
      s.endedAt,
      s.status,
      s.statusMessage,
      s.target,
      s.model,
      s.input,
      s.output,
      s.usage?.promptTokens ?? null,
      s.usage?.completionTokens ?? null,
      s.costUsd,
      s.firstTokenAt,
      s.metadata ? JSON.stringify(s.metadata) : null,
    );
  }
  db.prepare(
    `DELETE FROM ai_spans WHERE run_id IN (
       SELECT id FROM ai_runs ORDER BY created_at DESC LIMIT -1 OFFSET ?
     )`,
  ).run(TRACE_RETENTION_RUNS);
}

export function recordRun(run: NewAiRun): void {
  const db = getRunsDb();
  db.exec("BEGIN");
  try {
    insertRun(db, run);
    if (run.spans && run.spans.length > 0) insertSpans(db, run.id, run.spans);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getRunTrace(id: string): AiRunTrace | null {
  const db = getRunsDb();
  const row = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id) as RunRow | undefined;
  if (!row) return null;
  const spans = db
    .prepare("SELECT * FROM ai_spans WHERE run_id = ? ORDER BY started_at, rowid")
    .all(id) as SpanRow[];
  return { run: mapRun(row), spans: spans.map(mapSpan) };
}

function insertRun(db: DatabaseSync, run: NewAiRun): void {
  db
    .prepare(
      `INSERT OR REPLACE INTO ai_runs
        (id, created_at, task_type, strategy, initial_target, via, model, reason,
         fell_back, status, error_code, ttft_ms, total_ms, input_chars, output_chars, tool_calls,
         guardrails, prompt_tokens, completion_tokens, llm_calls, cost_usd, saved_usd,
         cache_mode, cache_similarity, cache_entry_id, cache_saved_ms, cache_saved_usd,
         difficulty, model_tier, escalated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.createdAt,
      run.taskType,
      run.strategy,
      run.initialTarget,
      run.via,
      run.model,
      run.reason,
      run.fellBack ? 1 : 0,
      run.status,
      run.errorCode,
      run.ttftMs,
      run.totalMs,
      run.inputChars,
      run.outputChars,
      run.toolCalls,
      run.guardrails.length > 0 ? JSON.stringify(run.guardrails) : null,
      run.usage?.promptTokens ?? null,
      run.usage?.completionTokens ?? null,
      run.usage?.calls ?? null,
      run.usage?.costUsd ?? null,
      run.usage?.savedUsd ?? null,
      run.cache?.mode ?? null,
      run.cache?.similarity ?? null,
      run.cache?.entryId ?? null,
      run.cache?.savedMs ?? null,
      run.cache?.savedUsd ?? null,
      run.difficulty,
      run.tier,
      run.escalated ? 1 : 0,
    );
}

/** The cache entry a run was served from, so negative feedback can evict it. */
export function getRunCacheEntryId(id: string): string | null {
  const row = getRunsDb()
    .prepare("SELECT cache_entry_id FROM ai_runs WHERE id = ?")
    .get(id) as { cache_entry_id: string | null } | undefined;
  return row?.cache_entry_id ?? null;
}

/** Returns false when the run id does not exist. `null` clears the rating. */
export function setRunFeedback(
  id: string,
  feedback: AiRunFeedback | null,
): boolean {
  const result = getRunsDb()
    .prepare("UPDATE ai_runs SET feedback = ? WHERE id = ?")
    .run(feedback, id);
  return Number(result.changes) > 0;
}

export function listRuns(limit = 20): AiRunRecord[] {
  const rows = getRunsDb()
    .prepare(`${RUN_SELECT} ORDER BY r.created_at DESC LIMIT ?`)
    .all(Math.max(1, Math.min(limit, 200))) as RunRow[];
  return rows.map(mapRun);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Model latency: successful runs only, and cache hits are excluded (they have their own
 * numbers in CacheStats) so errors, aborts and instant hits don't skew it.
 */
function latencyOf(runs: AiRunRecord[]): LatencyStats {
  const ok = runs.filter((r) => r.status === "ok" && !r.cache);
  const ttft = ok
    .map((r) => r.ttftMs)
    .filter((v): v is number => v != null);
  const total = ok.map((r) => r.totalMs);
  return {
    count: ok.length,
    ttftP50: percentile(ttft, 50),
    ttftP95: percentile(ttft, 95),
    totalP50: percentile(total, 50),
    totalP95: percentile(total, 95),
  };
}

const totalTokens = (u: RunUsage) => u.promptTokens + u.completionTokens;

function avgTokensOf(runs: AiRunRecord[]): number | null {
  const usages = runs.flatMap((r) => (r.usage ? [r.usage] : []));
  if (usages.length === 0) return null;
  return Math.round(usages.reduce((sum, u) => sum + totalTokens(u), 0) / usages.length);
}

function usageOf(runs: AiRunRecord[]): UsageStats {
  const usages = runs.flatMap((r) => (r.usage ? [r.usage] : []));
  const sum = (pick: (u: RunUsage) => number) =>
    usages.reduce((acc, u) => acc + pick(u), 0);
  const costUsd = sum((u) => u.costUsd);
  const savedUsd = sum((u) => u.savedUsd);
  return {
    runs: usages.length,
    promptTokens: sum((u) => u.promptTokens),
    completionTokens: sum((u) => u.completionTokens),
    avgTokensPerRun: avgTokensOf(runs),
    costUsd,
    savedUsd,
    savingsRate: costUsd + savedUsd > 0 ? savedUsd / (costUsd + savedUsd) : null,
  };
}

function cacheOf(runs: AiRunRecord[]): CacheStats {
  const hits = runs.filter((r) => r.cache);
  const answered = runs.filter((r) => r.status === "ok").length;
  return {
    hits: hits.length,
    hitRate: answered > 0 ? hits.length / answered : null,
    savedMs: hits.reduce((n, r) => n + (r.cache?.savedMs ?? 0), 0),
    savedUsd: hits.reduce((n, r) => n + (r.cache?.savedUsd ?? 0), 0),
    hitTotalP50: percentile(hits.map((r) => r.totalMs), 50),
  };
}

function tiersOf(runs: AiRunRecord[]): TierStats {
  const tier = (name: ModelTier) => {
    const tierRuns = runs.filter((r) => r.tier === name);
    const costUsd = tierRuns.reduce((n, r) => n + (r.usage?.costUsd ?? 0), 0);
    return {
      count: tierRuns.length,
      costUsd,
      avgCostUsd: tierRuns.length > 0 ? costUsd / tierRuns.length : null,
      totalP50: latencyOf(tierRuns).totalP50,
    };
  };
  const escalated = runs.filter((r) => r.escalated);
  return {
    assessed: runs.filter((r) => r.difficulty).length,
    complex: runs.filter((r) => r.difficulty === "complex").length,
    byTier: { standard: tier("standard"), strong: tier("strong") },
    escalated: escalated.length,
    escalationKept: escalated.filter((r) => r.tier === "strong").length,
  };
}

export function getRunStats(): AiRunStats {
  const runs = listRunsWindow();

  const byTaskMap = new Map<AiTaskType, AiRunRecord[]>();
  for (const run of runs) {
    byTaskMap.set(run.taskType, [...(byTaskMap.get(run.taskType) ?? []), run]);
  }

  const byGuardrailMap = new Map<string, AiRunGuardrail & { count: number }>();
  for (const run of runs) {
    for (const g of run.guardrails) {
      const key = `${g.stage}:${g.rule}:${g.action}`;
      const entry = byGuardrailMap.get(key) ?? { ...g, count: 0 };
      entry.count += 1;
      byGuardrailMap.set(key, entry);
    }
  }

  return {
    total: runs.length,
    localCount: runs.filter((r) => r.via === "local").length,
    cloudCount: runs.filter((r) => r.via === "cloud").length,
    fallbackCount: runs.filter((r) => r.fellBack).length,
    errorCount: runs.filter((r) => r.status === "error").length,
    abortedCount: runs.filter((r) => r.status === "aborted").length,
    blockedCount: runs.filter((r) => r.status === "blocked").length,
    guardrailRunCount: runs.filter((r) => r.guardrails.length > 0).length,
    byGuardrail: [...byGuardrailMap.values()].sort((a, b) => b.count - a.count),
    toolRunCount: runs.filter((r) => r.toolCalls > 0).length,
    feedbackUp: runs.filter((r) => r.feedback === 1).length,
    feedbackDown: runs.filter((r) => r.feedback === -1).length,
    latency: latencyOf(runs),
    usage: usageOf(runs),
    cache: cacheOf(runs),
    tiers: tiersOf(runs),
    byVia: {
      local: viaStats(runs.filter((r) => r.via === "local")),
      cloud: viaStats(runs.filter((r) => r.via === "cloud")),
    },
    byTask: [...byTaskMap.entries()]
      .map(([taskType, taskRuns]) => ({
        taskType,
        count: taskRuns.length,
        errorCount: taskRuns.filter((r) => r.status === "error").length,
        avgTokens: avgTokensOf(taskRuns),
        costUsd: taskRuns.reduce((acc, r) => acc + (r.usage?.costUsd ?? 0), 0),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

function viaStats(runs: AiRunRecord[]) {
  return { ...latencyOf(runs), avgTokens: avgTokensOf(runs) };
}

function listRunsWindow(): AiRunRecord[] {
  const rows = getRunsDb()
    .prepare("SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?")
    .all(STATS_WINDOW) as RunRow[];
  return rows.map(mapRun);
}
