/**
 * Run log for the Hybrid AI Gateway: one row per POST /api/ai/chat.
 * Feeds the /ai/runs observability board (route mix, fallback, latency, feedback).
 */
import { mkdirSync } from "fs";
import { dirname } from "path";
import { DatabaseSync } from "node:sqlite";
import { dataFilePath } from "@/lib/data-path";
import type { AiRouteTarget, AiStrategy, AiTaskType } from "./types";

export type AiRunStatus = "ok" | "error" | "aborted";
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
  feedback: AiRunFeedback | null;
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
  toolRunCount: number;
  feedbackUp: number;
  feedbackDown: number;
  latency: LatencyStats;
  byVia: Record<AiRouteTarget, LatencyStats>;
  byTask: { taskType: AiTaskType; count: number; errorCount: number }[];
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
  feedback: number | null;
};

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
  cached = db;
  return db;
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
    feedback:
      row.feedback === 1 ? 1 : row.feedback === -1 ? -1 : null,
  };
}

export function recordRun(run: Omit<AiRunRecord, "feedback">): void {
  getRunsDb()
    .prepare(
      `INSERT OR REPLACE INTO ai_runs
        (id, created_at, task_type, strategy, initial_target, via, model, reason,
         fell_back, status, error_code, ttft_ms, total_ms, input_chars, output_chars, tool_calls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export function getRunStats(): AiRunStats {
  const runs = listRunsWindow();

  const byTaskMap = new Map<AiTaskType, { count: number; errorCount: number }>();
  for (const run of runs) {
    const entry = byTaskMap.get(run.taskType) ?? { count: 0, errorCount: 0 };
    entry.count += 1;
    if (run.status === "error") entry.errorCount += 1;
    byTaskMap.set(run.taskType, entry);
  }

  return {
    total: runs.length,
    localCount: runs.filter((r) => r.via === "local").length,
    cloudCount: runs.filter((r) => r.via === "cloud").length,
    fallbackCount: runs.filter((r) => r.fellBack).length,
    errorCount: runs.filter((r) => r.status === "error").length,
    abortedCount: runs.filter((r) => r.status === "aborted").length,
    toolRunCount: runs.filter((r) => r.toolCalls > 0).length,
    feedbackUp: runs.filter((r) => r.feedback === 1).length,
    feedbackDown: runs.filter((r) => r.feedback === -1).length,
    latency: latencyOf(runs),
    byVia: {
      local: latencyOf(runs.filter((r) => r.via === "local")),
      cloud: latencyOf(runs.filter((r) => r.via === "cloud")),
    },
    byTask: [...byTaskMap.entries()]
      .map(([taskType, v]) => ({ taskType, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}

function listRunsWindow(): AiRunRecord[] {
  const rows = getRunsDb()
    .prepare("SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?")
    .all(STATS_WINDOW) as RunRow[];
  return rows.map(mapRun);
}
