import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionPlanJsonSchema,
  findUngroundedRefs,
  parseActionPlan,
  renderActionPlan,
  type ActionPlan,
} from "@/lib/ai/action-plan";
import { ACTION_PLAN_SECTIONS, checkActionPlan } from "@/lib/ai/guardrails/output";

const evidence = JSON.stringify([
  { id: "B-240909-01", toolId: "T-ETCH-07", yieldPct: 89.4 },
  { id: "A-004", code: "ETCH-YIELD-DROP", message: "Batch yield 89.4% below control limit (93%)" },
]);

const plan: ActionPlan = {
  inScope: true,
  summary: "T-ETCH-07 的 B-240909-01 良率 89.4%，低于控制限。",
  findings: [
    { text: "批次 B-240909-01 良率 89.4%，低于 93%", refs: ["B-240909-01", "ETCH-YIELD-DROP"] },
  ],
  causes: [{ text: "腔体状态漂移", confidence: "medium", refs: ["T-ETCH-07"] }],
  actions: [{ text: "暂停 T-ETCH-07 派工并做腔体检查", priority: "P0", owner: "设备工程师", refs: [] }],
  dataToConfirm: ["最近一次 PM 记录"],
};

describe("parseActionPlan", () => {
  it("accepts a valid plan, including one wrapped in a code fence", () => {
    const raw = JSON.stringify(plan);
    assert.deepEqual(parseActionPlan(raw), { ok: true, plan });
    assert.equal(parseActionPlan("```json\n" + raw + "\n```").ok, true);
  });

  it("rejects invalid JSON and schema violations with a readable error", () => {
    const notJson = parseActionPlan("{ not json");
    assert.equal(notJson.ok, false);
    assert.match(!notJson.ok ? notJson.error : "", /invalid JSON/);

    const badEnum = parseActionPlan(
      JSON.stringify({ ...plan, actions: [{ text: "x", priority: "urgent", owner: "" }] }),
    );
    assert.equal(badEnum.ok, false);
    assert.match(!badEnum.ok ? badEnum.error : "", /priority/);
  });

  it("only accepts ID-like refs", () => {
    const sentenceRef = {
      ...plan,
      findings: [{ text: "现象（事实）", refs: ["Critical Alert A-004 (Batch yield 89.4% below limit)"] }],
    };
    assert.equal(parseActionPlan(JSON.stringify(sentenceRef)).ok, false);
  });

  it("fills in missing action refs (plans from older prompts and cached answers)", () => {
    const legacyAction: Record<string, unknown> = { ...plan.actions[0] };
    delete legacyAction.refs;
    const parsed = parseActionPlan(JSON.stringify({ ...plan, actions: [legacyAction] }));
    assert.deepEqual(parsed, { ok: true, plan });
  });

  it("requires findings and actions for in-scope plans only", () => {
    const empty = { ...plan, findings: [], actions: [] };
    assert.equal(parseActionPlan(JSON.stringify(empty)).ok, false);
    const refusal = { ...empty, inScope: false, summary: "我只处理产线排查。", causes: [], dataToConfirm: [] };
    assert.equal(parseActionPlan(JSON.stringify(refusal)).ok, true);
  });
});

describe("actionPlanJsonSchema", () => {
  it("is a plain object schema without $schema, with every field required", () => {
    const schema = actionPlanJsonSchema();
    assert.equal(schema.$schema, undefined);
    assert.equal(schema.type, "object");
    assert.deepEqual(
      [...(schema.required as string[])].sort(),
      ["actions", "causes", "dataToConfirm", "findings", "inScope", "summary"],
    );
  });
});

describe("renderActionPlan", () => {
  it("renders all four required sections, so the text guardrails still pass", () => {
    const markdown = renderActionPlan(plan);
    for (const section of ACTION_PLAN_SECTIONS) assert.ok(markdown.includes(section.zh), section.zh);
    assert.ok(markdown.includes("〔B-240909-01, ETCH-YIELD-DROP〕"));
    assert.ok(markdown.includes("P0 · 暂停"));
    assert.deepEqual(checkActionPlan(markdown, evidence), []);
  });

  it("renders English titles and labels when asked, and they pass the section check", () => {
    const english: ActionPlan = {
      ...plan,
      summary: "B-240909-01 on T-ETCH-07 is at 89.4%, below the control limit.",
      findings: [{ text: "B-240909-01 yield 89.4%, below 93%", refs: ["B-240909-01", "ETCH-YIELD-DROP"] }],
      causes: [{ text: "Chamber condition drift", confidence: "medium", refs: ["T-ETCH-07"] }],
      actions: [{ text: "Hold T-ETCH-07 and inspect the chamber", priority: "P0", owner: "Equipment engineer", refs: [] }],
      dataToConfirm: ["Last PM record"],
    };
    const markdown = renderActionPlan(english, "en");
    assert.ok(markdown.startsWith("**Conclusion**: "));
    assert.ok(markdown.includes("## 1. Symptoms (facts)"));
    assert.ok(markdown.includes("[Medium] Chamber condition drift [T-ETCH-07]"));
    assert.ok(markdown.includes("P0 · Hold T-ETCH-07 and inspect the chamber (Equipment engineer)"));
    assert.doesNotMatch(markdown, /\p{Script=Han}/u);
    assert.deepEqual(checkActionPlan(markdown, evidence), []);
  });

  it("renders an out-of-scope plan as just the summary", () => {
    const refusal = { ...plan, inScope: false, summary: "我只处理产线排查。" };
    assert.equal(renderActionPlan(refusal), "我只处理产线排查。");
  });
});

describe("findUngroundedRefs", () => {
  it("flags refs that are not in the evidence", () => {
    assert.deepEqual(findUngroundedRefs(plan, evidence), []);
    const invented: ActionPlan = {
      ...plan,
      causes: [{ text: "真空泄漏", confidence: "high", refs: ["ETCH-VACUUM", "T-ETCH-07"] }],
    };
    assert.deepEqual(findUngroundedRefs(invented, evidence), ["ETCH-VACUUM"]);
  });

  it("checks document IDs cited by actions against the retrieved passages", () => {
    const cited: ActionPlan = {
      ...plan,
      actions: [{ text: "按湿法清洁 SOP 执行", priority: "P0", owner: "设备工程师", refs: ["SOP-ETCH-012"] }],
    };
    assert.deepEqual(findUngroundedRefs(cited, evidence), ["SOP-ETCH-012"]);
    assert.deepEqual(findUngroundedRefs(cited, `${evidence}\n[1] SOP-ETCH-012 · 湿法清洁`), []);
    assert.ok(renderActionPlan(cited).includes("P0 · 按湿法清洁 SOP 执行〔SOP-ETCH-012〕"));
  });
});
