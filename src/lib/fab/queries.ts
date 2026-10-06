import { createHash } from "crypto";
import { getFabDb } from "./db";
import type { FabAlert, FabBatch, FabSummary } from "./types";

/**
 * Fingerprint of everything the investigate tools can read. Any change (new batch, alert
 * acknowledged, reseed) yields a new value, which retires cached answers based on old data.
 * Full-table hash is fine at demo size; a real fab would use an updated_at / version column.
 */
export function getFabDataVersion(): string {
  const db = getFabDb();
  const hash = createHash("sha1");
  for (const sql of [
    "SELECT id, name, area FROM tools ORDER BY id",
    "SELECT * FROM batches ORDER BY id",
    "SELECT * FROM alerts ORDER BY id",
  ]) {
    hash.update(JSON.stringify(db.prepare(sql).all()));
  }
  return hash.digest("hex").slice(0, 12);
}

type BatchRow = {
  id: string;
  tool_id: string;
  tool_name: string;
  area: string;
  product_line: string;
  started_at: string;
  wafer_count: number;
  yield_pct: number;
  scrap_count: number;
  shift: string;
};

type AlertRow = {
  id: string;
  tool_id: string;
  tool_name: string;
  batch_id: string | null;
  severity: "info" | "warn" | "critical";
  code: string;
  message: string;
  created_at: string;
  acknowledged: number;
};

function mapBatch(row: BatchRow): FabBatch {
  return {
    id: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    area: row.area,
    productLine: row.product_line,
    startedAt: row.started_at,
    waferCount: row.wafer_count,
    yieldPct: row.yield_pct,
    scrapCount: row.scrap_count,
    shift: row.shift,
  };
}

function mapAlert(row: AlertRow): FabAlert {
  return {
    id: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    batchId: row.batch_id,
    severity: row.severity,
    code: row.code,
    message: row.message,
    createdAt: row.created_at,
    acknowledged: Boolean(row.acknowledged),
  };
}

export function listBatches(limit = 20): FabBatch[] {
  const db = getFabDb();
  const rows = db
    .prepare(
      `SELECT b.id, b.tool_id, t.name AS tool_name, t.area, b.product_line,
              b.started_at, b.wafer_count, b.yield_pct, b.scrap_count, b.shift
       FROM batches b
       JOIN tools t ON t.id = b.tool_id
       ORDER BY b.started_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 100))) as BatchRow[];
  return rows.map(mapBatch);
}

export function getBatchById(batchId: string): FabBatch | null {
  const db = getFabDb();
  const row = db
    .prepare(
      `SELECT b.id, b.tool_id, t.name AS tool_name, t.area, b.product_line,
              b.started_at, b.wafer_count, b.yield_pct, b.scrap_count, b.shift
       FROM batches b
       JOIN tools t ON t.id = b.tool_id
       WHERE b.id = ?
       LIMIT 1`,
    )
    .get(batchId) as BatchRow | undefined;
  return row ? mapBatch(row) : null;
}

export function listAlertsForBatch(batchId: string): FabAlert[] {
  const db = getFabDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.tool_id, t.name AS tool_name, a.batch_id, a.severity,
              a.code, a.message, a.created_at, a.acknowledged
       FROM alerts a
       JOIN tools t ON t.id = a.tool_id
       WHERE a.batch_id = ?
       ORDER BY a.created_at DESC`,
    )
    .all(batchId) as AlertRow[];
  return rows.map(mapAlert);
}

export function listAlerts(options?: {
  limit?: number;
  openOnly?: boolean;
}): FabAlert[] {
  const db = getFabDb();
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const openOnly = options?.openOnly ?? false;

  const rows = db
    .prepare(
      `SELECT a.id, a.tool_id, t.name AS tool_name, a.batch_id, a.severity,
              a.code, a.message, a.created_at, a.acknowledged
       FROM alerts a
       JOIN tools t ON t.id = a.tool_id
       WHERE (? = 0 OR a.acknowledged = 0)
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(openOnly ? 1 : 0, limit) as AlertRow[];

  return rows.map(mapAlert);
}

export function getFabSummary(): FabSummary {
  const db = getFabDb();

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM batches) AS batch_count,
         (SELECT COUNT(*) FROM alerts WHERE acknowledged = 0) AS open_alert_count,
         (SELECT COUNT(*) FROM alerts WHERE acknowledged = 0 AND severity = 'critical') AS critical_alert_count,
         (SELECT AVG(yield_pct) FROM batches) AS avg_yield_pct`,
    )
    .get() as {
    batch_count: number;
    open_alert_count: number;
    critical_alert_count: number;
    avg_yield_pct: number | null;
  };

  const batches = listBatches(1);
  const trendRows = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS day, AVG(yield_pct) AS avg_yield_pct
       FROM batches
       GROUP BY substr(started_at, 1, 10)
       ORDER BY day ASC`,
    )
    .all() as { day: string; avg_yield_pct: number }[];

  return {
    batchCount: counts.batch_count,
    openAlertCount: counts.open_alert_count,
    criticalAlertCount: counts.critical_alert_count,
    avgYieldPct:
      counts.avg_yield_pct == null
        ? null
        : Math.round(counts.avg_yield_pct * 10) / 10,
    latestBatch: batches[0] ?? null,
    yieldTrend: trendRows.map((r) => ({
      day: r.day,
      avgYieldPct: Math.round(r.avg_yield_pct * 10) / 10,
    })),
  };
}
