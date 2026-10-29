import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import {
  detachedToolContext,
  executeToolViaLangChain,
  listFabLangChainTools,
  listKnowledgeLangChainTools,
  toLangChainTool,
} from "@/lib/ai/tools/langchain";
import {
  listFabToolDefinitions,
  listKnowledgeToolDefinitions,
} from "@/lib/ai/tools/registry";

describe("LangChain tool adapters", () => {
  before(() => {
    process.chdir(mkdtempSync(join(tmpdir(), "langchain-tools-test-")));
    delete process.env.AI_RAG;
  });

  it("wraps fab tool definitions as LangChain StructuredTools", () => {
    const ctx = detachedToolContext();
    const tools = listFabLangChainTools(ctx);
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(
      names,
      listFabToolDefinitions()
        .map((def) => def.name)
        .sort(),
    );
    for (const tool of tools) {
      const def = listFabToolDefinitions().find((item) => item.name === tool.name)!;
      assert.equal(tool.description, def.description);
    }
  });

  it("wraps knowledge search when RAG is enabled", () => {
    process.env.AI_RAG = "on";
    const ctx = detachedToolContext();
    const tools = listKnowledgeLangChainTools(ctx);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      listKnowledgeToolDefinitions().map((def) => def.name),
    );
    delete process.env.AI_RAG;
  });

  it("executes get_fab_summary through LangChain invoke", async () => {
    const ctx = detachedToolContext({ target: "local" });
    const result = await executeToolViaLangChain("get_fab_summary", "{}", ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const data = result.data as { batchCount?: number };
    assert.equal(typeof data.batchCount, "number");
  });

  it("preserves invalid_args from the underlying executor", async () => {
    const ctx = detachedToolContext();
    const result = await executeToolViaLangChain(
      "get_fab_batch",
      JSON.stringify({ batchId: "B7" }),
      ctx,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "invalid_args");
    assert.match(result.error, /Invalid batchId format/);
  });

  it("rejects unknown tools before invoke", async () => {
    const ctx = detachedToolContext();
    const result = await executeToolViaLangChain("not_a_tool", "{}", ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "unknown_tool");
  });

  it("builds a single adapter with the original JSON schema", () => {
    const def = listFabToolDefinitions().find((item) => item.name === "list_fab_alerts")!;
    const tool = toLangChainTool(def, detachedToolContext());
    assert.equal(tool.name, "list_fab_alerts");
    assert.deepEqual(tool.schema, def.parameters);
  });
});
