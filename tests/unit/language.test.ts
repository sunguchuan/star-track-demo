import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectReplyLanguage } from "@/lib/ai/language";

describe("detectReplyLanguage", () => {
  it("answers English questions in English", () => {
    assert.equal(detectReplyLanguage("Why is chamber B7 yield dropping? Give me an action plan."), "en");
    assert.equal(detectReplyLanguage("Etch Chamber B7 yield is dropping — check alerts and draft an Action Plan"), "en");
  });

  it("answers Chinese questions in Chinese, even with English terms and IDs mixed in", () => {
    assert.equal(detectReplyLanguage("批次 B-240909-01 为什么低于控制限？"), "zh");
    assert.equal(detectReplyLanguage("Etch Chamber B7 最近良率下滑，帮我查告警并给 Action Plan"), "zh");
  });

  it("ignores IDs, alert codes and acronyms when counting English words", () => {
    assert.equal(detectReplyLanguage("B-240909-01 ETCH-PARTICLE MES CD-SEM 良率"), "zh");
  });

  it("defaults to Chinese when there is nothing to go on", () => {
    assert.equal(detectReplyLanguage("B-240909-01"), "zh");
    assert.equal(detectReplyLanguage(""), "zh");
  });
});
