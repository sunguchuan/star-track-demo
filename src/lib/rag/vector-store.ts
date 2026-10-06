/**
 * Chunk vectors for the knowledge base (table kb_vectors in data/kb-index.db).
 * Keyed by (chunk content hash, embedding model): editing a document only re-embeds the
 * chunks that changed, and local / cloud vectors never mix.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { dataFilePath } from "@/lib/data-path";

let db: DatabaseSync | null = null;

function getKbDb(): DatabaseSync {
  if (db) return db;
  const file = dataFilePath("kb-index.db");
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_vectors (
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (hash, model)
    )
  `);
  return db;
}

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** Copy first: SQLite blobs are not guaranteed to be 4-byte aligned. */
function fromBlob(blob: Uint8Array): Float32Array {
  const copy = blob.slice();
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function loadVectors(model: string): Map<string, Float32Array> {
  const rows = getKbDb()
    .prepare("SELECT hash, vector FROM kb_vectors WHERE model = ?")
    .all(model) as { hash: string; vector: Uint8Array }[];
  return new Map(rows.map((r) => [r.hash, fromBlob(r.vector)]));
}

export function saveVectors(model: string, entries: { hash: string; vector: Float32Array }[]): void {
  if (entries.length === 0) return;
  const conn = getKbDb();
  const insert = conn.prepare(
    "INSERT OR REPLACE INTO kb_vectors (hash, model, dims, vector, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  conn.exec("BEGIN");
  try {
    for (const e of entries) insert.run(e.hash, model, e.vector.length, toBlob(e.vector), now);
    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
