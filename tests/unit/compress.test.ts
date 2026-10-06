import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { compactToolResult, promptCompressionEnabled } from "@/lib/ai/compress";

const alerts = [
  { id: "A-006", code: "ETCH-GAS-RATIO", batchId: "B-1", createdAt: "2026-09-09T10:40:00Z", acknowledged: false },
  { id: "A-005", code: "PM-DUE", batchId: null, createdAt: "2026-09-09T09:00:30Z", acknowledged: false },
];

describe("compactToolResult", () => {
  it("renders flat rows as a table with constant columns hoisted", () => {
    assert.equal(
      compactToolResult(alerts),
      [
        "same for all rows: acknowledged=false",
        "id | code | batchId | createdAt",
        "A-006 | ETCH-GAS-RATIO | B-1 | 2026-09-09 10:40Z",
        "A-005 | PM-DUE | - | 2026-09-09 09:00:30Z",
      ].join("\n"),
    );
  });

  it("does not hoist columns of a single row", () => {
    assert.equal(compactToolResult([alerts[0]]), "id | code | batchId | createdAt | acknowledged\nA-006 | ETCH-GAS-RATIO | B-1 | 2026-09-09 10:40Z | false");
  });

  it("renders objects as key=value lines with nested blocks", () => {
    const text = compactToolResult({ batchCount: 12, latest: { id: "B-1", yieldPct: 93.8 }, trend: [] });
    assert.equal(text, "batchCount=12\nlatest: id=B-1; yieldPct=93.8\ntrend (0):\n  (none)");
  });

  it("replaces rows already shown earlier in the round with a back-reference", () => {
    const seen = new Set<string>();
    compactToolResult({ id: "B-1", alerts: [alerts[0]] }, seen);
    const text = compactToolResult(alerts, seen);
    assert.match(text, /also: A-006 \(listed above\)/);
    assert.doesNotMatch(text, /ETCH-GAS-RATIO/);
    assert.match(text, /PM-DUE/);
  });

  it("keeps rows whose content differs even when the id repeats", () => {
    const seen = new Set<string>();
    compactToolResult([alerts[0]], seen);
    const text = compactToolResult([{ ...alerts[0], acknowledged: true }], seen);
    assert.match(text, /ETCH-GAS-RATIO/);
  });

  it("escapes table separators and newlines inside values", () => {
    const text = compactToolResult([{ id: "X", message: "a | b\nc" }, { id: "Y", message: "ok" }]);
    assert.match(text, /X \| a \\\| b\\nc/);
  });

  it("keeps every cited value verbatim", () => {
    const data = [
      { id: "B-240909-01", toolName: "Etch Chamber B7", yieldPct: 89.4, code: "ETCH-YIELD-DROP" },
      { id: "B-240908-02", toolName: "CD-SEM Metrology C3", yieldPct: 92.1, code: "CD-OUTLIER" },
    ];
    const text = compactToolResult(data);
    for (const row of data) for (const value of Object.values(row)) assert.ok(text.includes(String(value)));
  });
});

describe("promptCompressionEnabled", () => {
  afterEach(() => {
    delete process.env.AI_PROMPT_COMPRESSION;
  });

  it("is on by default and turned off with AI_PROMPT_COMPRESSION=off", () => {
    assert.equal(promptCompressionEnabled(), true);
    process.env.AI_PROMPT_COMPRESSION = "OFF";
    assert.equal(promptCompressionEnabled(), false);
  });
});
