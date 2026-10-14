import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promptPreview, withHiddenContext } from "@/lib/ai/trace";

describe("promptPreview", () => {
  it("returns a lone message unchanged", () => {
    assert.equal(promptPreview([{ role: "user", content: "Why is B7 yield dropping?" }]), "Why is B7 yield dropping?");
  });

  it("outlines earlier messages and names tool results sent as user messages (plan call)", () => {
    const preview = promptPreview([
      { role: "system", content: "You are a fab co-pilot." },
      { role: "user", content: "Why is B7 yield dropping?" },
      { role: "assistant", content: "(called tools: list_fab_batches, list_fab_alerts)" },
      { role: "user", content: `<tool_result name="list_fab_batches">\n${"x".repeat(1200)}\n</tool_result>` },
      { role: "user", content: '<tool_result name="list_fab_alerts">\nrows\n</tool_result>' },
      { role: "user", content: "Based only on the tool results above, return the Action Plan." },
    ]);
    assert.equal(
      preview,
      "[Also sent, not shown: system prompt · 1 earlier user message · 1 assistant message · " +
        "2 tool results: list_fab_batches (1,200 chars), list_fab_alerts (4 chars)]\n\n" +
        "Based only on the tool results above, return the Action Plan.",
    );
  });

  it("recognizes native tool-role messages", () => {
    const preview = promptPreview([
      { role: "system", content: "s" },
      { role: "tool", name: "get_fab_summary", content: "{}" },
      { role: "user", content: "next" },
    ]);
    assert.match(preview, /system prompt · 1 tool result: get_fab_summary \(2 chars\)\]\n\nnext$/);
  });

  it("names chat history for plain chat calls", () => {
    const preview = promptPreview([
      { role: "system", content: "s" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "polish this" },
    ]);
    assert.equal(preview, "[Also sent, not shown: system prompt · 2 earlier user messages · 2 assistant messages]\n\npolish this");
  });
});

describe("withHiddenContext", () => {
  it("leaves the text alone when nothing else was sent", () => {
    assert.equal(withHiddenContext("query", []), "query");
  });
});
