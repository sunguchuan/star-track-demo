export type FabTool = {
  id: string;
  name: string;
  area: string;
};

export type FabBatch = {
  id: string;
  toolId: string;
  toolName: string;
  area: string;
  productLine: string;
  startedAt: string;
  waferCount: number;
  yieldPct: number;
  scrapCount: number;
  shift: string;
};

export type FabAlert = {
  id: string;
  toolId: string;
  toolName: string;
  batchId: string | null;
  severity: "info" | "warn" | "critical";
  code: string;
  message: string;
  createdAt: string;
  acknowledged: boolean;
};

export type FabSummary = {
  batchCount: number;
  openAlertCount: number;
  criticalAlertCount: number;
  avgYieldPct: number | null;
  latestBatch: FabBatch | null;
  yieldTrend: { day: string; avgYieldPct: number }[];
};
