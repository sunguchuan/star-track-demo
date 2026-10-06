import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessDifficulty } from "@/lib/ai/difficulty";

const level = (input: string, taskType: Parameters<typeof assessDifficulty>[0]["taskType"] = "investigate") =>
  assessDifficulty({ taskType, input }).level;

describe("assessDifficulty", () => {
  it("routes multi-entity comparisons and causal links to the strong tier", () => {
    assert.equal(level("CD-SEM C3 上的 CD 异常和刻蚀问题有关吗？"), "complex");
    assert.equal(level("A 班和 B 班的良率有明显差异吗？"), "complex");
    assert.equal(level("NAND-V8 和 DRAM-1z 两条产品线的良率情况怎么样？"), "complex");
    assert.equal(level("Compare line A and line B yield over the last week"), "complex");
  });

  it("keeps single-entity lookups and root-cause questions on the standard tier", () => {
    assert.equal(level("Etch Chamber B7 最近良率下滑，帮我查告警并给 Action Plan"), "simple");
    assert.equal(level("批次 B-240909-01 为什么低于控制限？"), "simple");
    assert.equal(level("Litho Scanner A1 目前有什么需要注意的？"), "simple");
    assert.equal(level("Why is chamber B7 yield dropping? Give me an action plan."), "simple");
    assert.equal(level("当前未关闭的严重告警有哪些？按优先级给处理建议"), "simple");
  });

  it("never escalates mechanical rewrite tasks", () => {
    const long = "对比 A 班和 B 班的良率差异，分析根因。".repeat(60);
    assert.deepEqual(assessDifficulty({ taskType: "summarize", input: long }), {
      level: "simple",
      score: 0,
      signals: [],
    });
  });

  it("counts long input, multiple questions and long history", () => {
    const result = assessDifficulty({
      taskType: "chat",
      input: `${"背景说明。".repeat(130)}B7 怎么了？下一步做什么？`,
      history: [{ role: "assistant", content: "x".repeat(2100) }],
    });
    assert.equal(result.level, "complex");
    assert.deepEqual(result.signals, ["very_long_input", "multi_question", "long_history"]);
  });

  it("ignores bare numbers and direction words when counting entities", () => {
    const result = assessDifficulty({ taskType: "investigate", input: "最近 7 天 B7 良率下降了 3 个点" });
    assert.ok(!result.signals.includes("multi_entity"));
  });
});
