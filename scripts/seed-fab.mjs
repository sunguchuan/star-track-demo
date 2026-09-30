/**
 * Seed / reset the demo FAB SQLite database.
 * Usage: npm run seed:fab
 */
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { dirname, join } from "path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = join(process.cwd(), "data", "fab.db");

mkdirSync(dirname(DB_PATH), { recursive: true });
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Removed existing ${DB_PATH}`);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL
  );
  CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL REFERENCES tools(id),
    product_line TEXT NOT NULL,
    started_at TEXT NOT NULL,
    wafer_count INTEGER NOT NULL,
    yield_pct REAL NOT NULL,
    scrap_count INTEGER NOT NULL,
    shift TEXT NOT NULL
  );
  CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL REFERENCES tools(id),
    batch_id TEXT,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );
`);

const insertTool = db.prepare(
  "INSERT INTO tools (id, name, area) VALUES (?, ?, ?)",
);
const insertBatch = db.prepare(
  `INSERT INTO batches
    (id, tool_id, product_line, started_at, wafer_count, yield_pct, scrap_count, shift)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertAlert = db.prepare(
  `INSERT INTO alerts
    (id, tool_id, batch_id, severity, code, message, created_at, acknowledged)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

for (const t of [
  ["T-LITHO-01", "Litho Scanner A1", "lithography"],
  ["T-ETCH-07", "Etch Chamber B7", "etch"],
  ["T-MET-03", "CD-SEM Metrology C3", "metrology"],
]) {
  insertTool.run(...t);
}

for (const b of [
  ["B-240901-01", "T-LITHO-01", "DRAM-1z", "2026-09-01T06:10:00Z", 25, 97.2, 1, "A"],
  ["B-240901-02", "T-ETCH-07", "DRAM-1z", "2026-09-01T09:40:00Z", 25, 96.8, 1, "A"],
  ["B-240902-01", "T-MET-03", "DRAM-1z", "2026-09-02T07:00:00Z", 25, 97.5, 0, "A"],
  ["B-240903-01", "T-LITHO-01", "NAND-V8", "2026-09-03T06:20:00Z", 25, 96.1, 2, "B"],
  ["B-240904-01", "T-ETCH-07", "NAND-V8", "2026-09-04T10:15:00Z", 25, 95.9, 2, "B"],
  ["B-240905-01", "T-MET-03", "DRAM-1z", "2026-09-05T08:05:00Z", 25, 96.4, 1, "A"],
  ["B-240906-01", "T-LITHO-01", "DRAM-1z", "2026-09-06T06:00:00Z", 25, 95.8, 2, "C"],
  ["B-240907-01", "T-ETCH-07", "DRAM-1z", "2026-09-07T11:30:00Z", 25, 94.2, 3, "A"],
  ["B-240908-01", "T-ETCH-07", "DRAM-1z", "2026-09-08T07:45:00Z", 25, 91.6, 4, "A"],
  ["B-240908-02", "T-MET-03", "DRAM-1z", "2026-09-08T14:20:00Z", 25, 92.1, 3, "B"],
  ["B-240909-01", "T-ETCH-07", "DRAM-1z", "2026-09-09T06:30:00Z", 25, 89.4, 5, "A"],
  ["B-240909-02", "T-LITHO-01", "DRAM-1z", "2026-09-09T12:00:00Z", 25, 93.8, 2, "B"],
]) {
  insertBatch.run(...b);
}

for (const a of [
  [
    "A-001",
    "T-ETCH-07",
    "B-240907-01",
    "warn",
    "ETCH-RF-DRIFT",
    "RF power drift +3.2% vs baseline on chamber B7",
    "2026-09-07T12:05:00Z",
    1,
  ],
  [
    "A-002",
    "T-ETCH-07",
    "B-240908-01",
    "critical",
    "ETCH-PARTICLE",
    "Particle count spike during DRAM-1z etch; yield impact suspected",
    "2026-09-08T08:10:00Z",
    0,
  ],
  [
    "A-003",
    "T-MET-03",
    "B-240908-02",
    "warn",
    "CD-OUTLIER",
    "Critical dimension outliers on 3 wafers post-etch",
    "2026-09-08T15:00:00Z",
    0,
  ],
  [
    "A-004",
    "T-ETCH-07",
    "B-240909-01",
    "critical",
    "ETCH-YIELD-DROP",
    "Batch yield 89.4% below control limit (93%)",
    "2026-09-09T07:15:00Z",
    0,
  ],
  [
    "A-005",
    "T-LITHO-01",
    null,
    "info",
    "PM-DUE",
    "Preventive maintenance window due within 48h",
    "2026-09-09T09:00:00Z",
    0,
  ],
  [
    "A-006",
    "T-ETCH-07",
    "B-240909-01",
    "warn",
    "ETCH-GAS-RATIO",
    "Process gas ratio near upper spec on recent recipes",
    "2026-09-09T10:40:00Z",
    0,
  ],
]) {
  insertAlert.run(...a);
}

db.close();
console.log(`Seeded FAB demo DB at ${DB_PATH}`);
