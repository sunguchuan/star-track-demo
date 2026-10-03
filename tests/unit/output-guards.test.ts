import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkActionPlan,
  checkGrounding,
  checkOutputSecrets,
} from "@/lib/ai/guardrails/output";

const evidence = JSON.stringify([
  { id: "B-240901-02", toolId: "T-ETCH-07", startedAt: "2026-09-01T09:40:00Z", waferCount: 25, yieldPct: 96.8, scrapCount: 1 },
  { id: "B-240909-01", toolId: "T-ETCH-07", startedAt: "2026-09-09T06:30:00Z", waferCount: 25, yieldPct: 89.4, scrapCount: 5 },
  { id: "A-004", code: "ETCH-YIELD-DROP", message: "Batch yield 89.4% below control limit (93%)" },
]);

const fullPlan = `1. 现象（事实）
T-ETCH-07 的批次 B-240909-01 良率 89.4%，低于控制限 93%，触发 ETCH-YIELD-DROP。
2. 可能原因
腔体状态漂移。
3. 建议动作（可执行）
暂停 T-ETCH-07 派工并做腔体检查。
4. 需确认的数据
最近一次 PM 记录。`;

describe("checkGrounding", () => {
  it("accepts IDs, codes and percentages that appear in the evidence", () => {
    assert.deepEqual(checkGrounding(fullPlan, evidence), []);
  });

  it("accepts percentages derived from evidence numbers", () => {
    assert.deepEqual(checkGrounding("良率下降 7.4%（96.8 → 89.4）", evidence), []);
    assert.deepEqual(checkGrounding("报废率 20%", evidence), []);
  });

  it("treats 0% and 100% as wording, not data", () => {
    assert.deepEqual(checkGrounding("对隔离批次做 100% 全检，目标 0% 漏检", evidence), []);
  });

  it("flags invented batch IDs, tool IDs, alert codes and numbers", () => {
    const made = "B-240910-03 在 T-ETCH-09 上出现 ETCH-PLASMA-ARC，良率 85.5%";
    assert.deepEqual(checkGrounding(made, evidence), [
      "B-240910-03",
      "T-ETCH-09",
      "ETCH-PLASMA-ARC",
      "85.5%",
    ]);
  });

  it("does not let date digits ground arbitrary percentages", () => {
    const onlyDate = JSON.stringify({ startedAt: "2026-09-09T06:30:00Z", yieldPct: 89.4 });
    assert.deepEqual(checkGrounding("下降 9%", onlyDate), ["9%"]);
  });
});

describe("checkActionPlan", () => {
  it("passes a complete, grounded plan", () => {
    assert.deepEqual(checkActionPlan(fullPlan, evidence), []);
  });

  it("warns about missing sections", () => {
    const partial = `1. 现象（事实）\nB-240909-01 良率低。${"腔体状态需要进一步排查。".repeat(20)}`;
    const hits = checkActionPlan(partial, evidence);
    assert.equal(hits[0]?.rule, "missing_sections");
    assert.equal(hits[0]?.detail, "可能原因、建议动作、需确认的数据");
  });

  it("does not demand sections from short replies such as refusals", () => {
    assert.deepEqual(checkActionPlan("抱歉，我只处理产线排查相关的问题。", evidence), []);
  });

  it("does not flag IDs the user supplied", () => {
    const sources = `批次 B-240915-01 的良率是多少？\n${evidence}`;
    assert.deepEqual(checkActionPlan("数据中没有批次 B-240915-01 的记录。", sources), []);
  });

  it("ignores empty output", () => {
    assert.deepEqual(checkActionPlan("  ", evidence), []);
  });
});

describe("checkOutputSecrets", () => {
  it("warns on secrets but not on PII", () => {
    assert.equal(checkOutputSecrets("token sk-abcdefghijklmnopqrstuvwx")[0]?.rule, "output_secret");
    assert.deepEqual(checkOutputSecrets("联系 eng@example.com / 13812345678"), []);
  });
});
