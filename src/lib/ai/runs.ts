/**
 * Run log for the Hybrid AI Gateway: one row per POST /api/ai/chat.
 * Feeds the /ai/runs observability board (route mix, fallback, latency, tokens/cost, feedback).
 */
import { mkdirSync } from "fs";
import { dirname } from "path";
import { DatabaseSync } from "node:sqlite";
import { dataFilePath } from "@/lib/data-path";
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
};

/** Columns added after the first release; created on startup if missing. */
const ADDED_COLUMNS: [name: string, type: string][] = [
  ["guardrails", "TEXT"],
  ["prompt_tokens", "INTEGER"],
  ["completion_tokens", "INTEGER"],
  ["llm_calls", "INTEGER"],
  ["cost_usd", "REAL"],
  ["saved_usd", "REAL"],
];

const STATS_WINDOW = 500;

let cached: DatabaseSync | null = null;

function getRunsDb(): DatabaseSync {
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
  };
}

export function recordRun(run: Omit<AiRunRecord, "feedback">): void {
  getRunsDb()
    .prepare(
      `INSERT OR REPLACE INTO ai_runs
        (id, created_at, task_type, strategy, initial_target, via, model, reason,
         fell_back, status, error_code, ttft_ms, total_ms, input_chars, output_chars, tool_calls,
         guardrails, prompt_tokens, completion_tokens, llm_calls, cost_usd, saved_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
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
    .prepare("SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?")
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

/** Latency only counts successful runs so errors/aborts don't skew the numbers. */
function latencyOf(runs: AiRunRecord[]): LatencyStats {
  const ok = runs.filter((r) => r.status === "ok");
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
