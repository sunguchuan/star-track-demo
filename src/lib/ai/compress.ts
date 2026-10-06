/**
 * Compact, lossless rendering of tool results for the model prompt. JSON repeats every key
 * on every row; tool results dominate investigate input tokens. Rules:
 * - arrays of flat objects become tables (header once, " | " separated);
 * - columns with one value across all rows are hoisted into a "same for all rows" line;
 * - ISO timestamps drop the "T" and zero seconds; null renders as "-";
 * - rows already shown in an earlier tool result of the same round (same id, same content)
 *   are replaced by a back-reference.
 * Values are kept verbatim otherwise, so every ID / code / number the model may cite survives.
 */

type Scalar = string | number | boolean | null;
type Row = Record<string, Scalar>;

/** Serialized rows already rendered in this tool round, for cross-tool dedupe. */
export type SeenRows = Set<string>;

export function promptCompressionEnabled(): boolean {
  return process.env.AI_PROMPT_COMPRESSION?.trim().toLowerCase() !== "off";
}

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?Z$/;

function isScalar(value: unknown): value is Scalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlatRow(value: unknown): value is Row {
  return isPlainObject(value) && Object.values(value).every(isScalar);
}

function formatScalar(value: Scalar): string {
  if (value === null) return "-";
  if (typeof value !== "string") return String(value);
  const iso = ISO_TIMESTAMP.exec(value);
  if (iso) {
    const seconds = iso[3] && !/^:00(?:\.0+)?$/.test(iso[3]) ? iso[3] : "";
    return `${iso[1]} ${iso[2]}${seconds}Z`;
  }
  return value.replace(/\r?\n/g, "\\n");
}

const cell = (value: Scalar | undefined) =>
  value === undefined ? "-" : formatScalar(value).replace(/\|/g, "\\|");

const pairs = (entries: [string, Scalar][]) =>
  entries.map(([key, value]) => `${key}=${formatScalar(value)}`).join("; ");

const rowKey = (row: Record<string, unknown>) => JSON.stringify(row);

function rememberRow(row: Record<string, unknown>, seen: SeenRows): void {
  if (typeof row.id === "string") seen.add(rowKey(row));
}

function table(rows: Row[], indent: string, seen: SeenRows): string[] {
  const fresh = rows.filter((row) => !seen.has(rowKey(row)));
  const repeated = rows.filter((row) => seen.has(rowKey(row))).map((row) => String(row.id));
  const lines: string[] = [];

  if (fresh.length > 0) {
    const columns = [...new Set(fresh.flatMap((row) => Object.keys(row)))];
    const constant =
      fresh.length > 1
        ? columns.filter((key) => fresh.every((row) => key in row && row[key] === fresh[0][key]))
        : [];
    const varying = columns.filter((key) => !constant.includes(key));
    if (constant.length > 0) {
      lines.push(`${indent}same for all rows: ${pairs(constant.map((key) => [key, fresh[0][key]]))}`);
    }
    if (varying.length > 0) {
      lines.push(`${indent}${varying.join(" | ")}`);
      for (const row of fresh) lines.push(`${indent}${varying.map((key) => cell(row[key])).join(" | ")}`);
    }
    for (const row of fresh) rememberRow(row, seen);
  }
  if (repeated.length > 0) lines.push(`${indent}also: ${repeated.join(", ")} (listed above)`);
  return lines;
}

function renderArray(items: unknown[], indent: string, seen: SeenRows): string[] {
  if (items.length === 0) return [`${indent}(none)`];
  if (items.every(isFlatRow)) return table(items, indent, seen);
  if (items.every(isScalar)) return [`${indent}${items.map((v) => cell(v)).join(" | ")}`];
  return items.flatMap((item) => {
    const [first = "", ...rest] = render(item, `${indent}  `, seen);
    return [`${indent}- ${first.trimStart()}`, ...rest];
  });
}

function renderObject(object: Record<string, unknown>, indent: string, seen: SeenRows): string[] {
  const scalars = Object.entries(object).filter((entry): entry is [string, Scalar] => isScalar(entry[1]));
  const lines = scalars.length > 0 ? [`${indent}${pairs(scalars)}`] : [];
  for (const [key, value] of Object.entries(object)) {
    if (isScalar(value)) continue;
    if (Array.isArray(value)) {
      lines.push(`${indent}${key} (${value.length}):`, ...renderArray(value, `${indent}  `, seen));
    } else if (isFlatRow(value) && seen.has(rowKey(value))) {
      lines.push(`${indent}${key}: ${String(value.id)} (listed above)`);
    } else if (isFlatRow(value)) {
      lines.push(`${indent}${key}: ${pairs(Object.entries(value))}`);
      rememberRow(value, seen);
    } else if (isPlainObject(value)) {
      lines.push(`${indent}${key}:`, ...renderObject(value, `${indent}  `, seen));
    }
  }
  rememberRow(object, seen);
  return lines;
}

function render(value: unknown, indent: string, seen: SeenRows): string[] {
  if (Array.isArray(value)) return renderArray(value, indent, seen);
  if (isPlainObject(value)) return renderObject(value, indent, seen);
  return [`${indent}${isScalar(value) ? formatScalar(value) : String(value)}`];
}

/** Compact text for one successful tool result; share `seen` across the tools of a round. */
export function compactToolResult(data: unknown, seen: SeenRows = new Set()): string {
  return render(data, "", seen).join("\n");
}
