import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { localizeAiText } from "@/lib/ai/localize";

const CJK = /[\u4e00-\u9fff]/;
const en = (text: string) => localizeAiText(text, "en");

/** Files whose Chinese strings reach the UI as guardrail messages, errors, hints or route reasons. */
const SOURCES = [
  "src/app/api/ai/chat/route.ts",
  "src/lib/ai/agents/investigate.ts",
  "src/lib/ai/agents/planner.ts",
  "src/lib/ai/agents/specialists/runner.ts",
  "src/lib/ai/cloud.ts",
  "src/lib/ai/embeddings.ts",
  "src/lib/ai/errors.ts",
  "src/lib/ai/guardrails/input.ts",
  "src/lib/ai/guardrails/output.ts",
  "src/lib/ai/ollama.ts",
  "src/lib/ai/router.ts",
];

describe("localizeAiText", () => {
  it("leaves Chinese untouched for the zh locale, and empty values alone", () => {
    assert.equal(localizeAiText("检测到疑似提示词注入，已拦截", "zh"), "检测到疑似提示词注入，已拦截");
    assert.equal(localizeAiText(null, "en"), null);
    assert.equal(localizeAiText("", "en"), "");
  });

  it("translates every static Chinese message in the Gateway sources", () => {
    const missing: string[] = [];
    for (const file of SOURCES) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        // Comments and single-quoted prompt skeletons are not UI text.
        if (/^\s*(\/\/|\*|')/.test(line)) continue;
        for (const [, literal] of line.matchAll(/"([^"]*[\u4e00-\u9fff][^"]*)"/g)) {
          // Multi-line prompt literals are model input, not UI text.
          if (literal.includes("\\n")) continue;
          if (CJK.test(en(literal))) missing.push(`${file}: ${literal}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it("translates templated messages", () => {
    const cases: [string, string][] = [
      ["云端服务暂时不可用 (503)", "Cloud service temporarily unavailable (503)"],
      ["本地服务暂时不可用", "Local service temporarily unavailable"],
      ["输入过长（9000 字），超过上限 8000 字", "Input too long (9000 characters; the limit is 8000)"],
      ["运行超过 120 秒上限，已停止", "The run exceeded the 120 s limit and was stopped"],
      ["单轮工具调用超过 5 次，只执行前 5 个", "More than 5 tool calls in one round; only the first 5 were run"],
      ["任务「investigate」走云端", "Task “investigate” goes to cloud"],
      ["相似问题已有答案（相似度 97.3%），直接返回缓存", "A similar question was answered before (similarity 97.3%); returned from the cache"],
      ["请求过于频繁（每分钟最多 20 次），请 12 秒后再试", "Too many requests (at most 20 per minute); try again in 12 s"],
      ["timeout: 生成超时，已停止", "timeout: Generation timed out and was stopped"],
    ];
    for (const [zh, expected] of cases) assert.equal(en(zh), expected);
  });

  it("translates composed route reasons part by part", () => {
    assert.equal(
      en("任务「investigate」走云端；问题较复杂（multi_entity + comparison），改用强模型"),
      "Task “investigate” goes to cloud; Complex question (multi_entity + comparison); using the strong model",
    );
    assert.equal(en("云端限流，已自动降级本地"), "Cloud rate limited; fell back to local");
    assert.equal(
      en("标准模型引用了工具结果中没有的编号（B-999999-01），已升级强模型重新生成 Action Plan"),
      "Standard model cited IDs that are not in the tool results (B-999999-01); regenerated the Action Plan on the strong model",
    );
    assert.equal(
      en("强模型云端服务暂时不可用 (503)，正在改用标准模型…"),
      "Strong model: Cloud service temporarily unavailable (503); switching to the standard model…",
    );
  });

  it("translates guardrail details", () => {
    assert.equal(en("私钥×1、API Key×2"), "private key ×1, API Key ×2");
    assert.equal(en("现象、需确认的数据"), "Symptoms, Data to confirm");
    assert.equal(en("B-1, B-2, B-3 等 9 项"), "B-1, B-2, B-3 (9 in total)");
  });

  it("passes unknown text through, e.g. raw provider errors", () => {
    assert.equal(en("Model gemini-x is overloaded"), "Model gemini-x is overloaded");
    assert.equal(en("ignore_instructions: “Ignore all previous instructions”"), "ignore_instructions: “Ignore all previous instructions”");
  });
});
