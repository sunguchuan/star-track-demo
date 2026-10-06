import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type TextResult = { isError?: boolean; content: { type: string; text?: string }[] };
const textOf = (result: unknown) => (result as TextResult).content.map((c) => c.text ?? "").join("\n");

const logs: string[] = [];
let client: Client;
let fabServer: typeof import("@/lib/mcp/fab-server");

before(async () => {
  // The fab DB path is fixed at import time from the cwd: import only after moving to a scratch
  // dir holding a copy of the knowledge base, so the demo data/ is never touched.
  const repo = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), "mcp-server-test-"));
  cpSync(join(repo, "data", "kb"), join(scratch, "data", "kb"), { recursive: true });
  process.chdir(scratch);
  delete process.env.OPENAI_API_KEY;
  // No Ollama in tests: embedding fails, so knowledge search runs on BM25 alone.
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  fabServer = await import("@/lib/mcp/fab-server");
  const server = fabServer.createFabMcpServer({ target: "local", log: (line) => logs.push(line) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

after(async () => {
  await client?.close();
});

describe("fab MCP server", () => {
  it("advertises the agent's tools as read-only, with their JSON schemas intact", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "get_fab_batch",
      "get_fab_summary",
      "list_fab_alerts",
      "list_fab_batches",
      "search_fab_knowledge",
    ]);
    const { listToolDefinitions } = await import("@/lib/ai/tools/registry");
    for (const def of listToolDefinitions()) {
      const tool = tools.find((t) => t.name === def.name)!;
      assert.equal(tool.annotations?.readOnlyHint, true, def.name);
      assert.equal(tool.description, def.description);
      const { $schema, ...schema } = tool.inputSchema as Record<string, unknown>;
      void $schema;
      assert.deepEqual(schema, def.parameters, def.name);
    }
  });

  it("returns fab data as JSON text", async () => {
    const result = await client.callTool({ name: "list_fab_alerts", arguments: { limit: 3, openOnly: false } });
    assert.notEqual((result as TextResult).isError, true);
    const rows = JSON.parse(textOf(result)) as { code: string }[];
    assert.ok(rows.length > 0 && rows.length <= 3);
    assert.ok(rows.every((r) => typeof r.code === "string"));
  });

  it("reports the tool's own argument checks as tool errors", async () => {
    const result = await client.callTool({ name: "get_fab_batch", arguments: { batchId: "B7" } });
    assert.equal((result as TextResult).isError, true);
    assert.match(textOf(result), /^invalid_args: Invalid batchId format/);
  });

  it("searches the knowledge base with citable document IDs, in the language of the query", async () => {
    const zh = textOf(
      await client.callTool({ name: "search_fab_knowledge", arguments: { query: "ETCH-RF-DRIFT 告警已确认 还需要处理吗" } }),
    );
    assert.match(zh, /RB-ETCH-RF-DRIFT/);
    assert.match(zh, /\(bm25\)/);

    const en = textOf(
      await client.callTool({
        name: "search_fab_knowledge",
        arguments: { query: "The ETCH-RF-DRIFT alert is acknowledged. Do we still need to act on it?" },
      }),
    );
    assert.match(en, /RB-ETCH-RF-DRIFT · ETCH-RF-DRIFT RF Power Drift Alert Runbook/);

    const line = logs.findLast((l) => l.startsWith("search_fab_knowledge"));
    assert.match(line ?? "", /ok \d+ms target=local sources=.*RB-ETCH-RF-DRIFT.*\[.*rag\.bm25/);
  });

  it("exposes every knowledge document as a markdown resource", async () => {
    const { resources } = await client.listResources();
    assert.ok(resources.length >= 13);
    assert.ok(resources.every((r) => r.uri.startsWith(fabServer.KB_RESOURCE_PREFIX) && r.mimeType === "text/markdown"));

    const { contents } = await client.readResource({ uri: `${fabServer.KB_RESOURCE_PREFIX}SOP-ETCH-021` });
    const text = String((contents[0] as { text: string }).text);
    assert.match(text, /^# SOP-ETCH-021 · /);
    assert.match(text, /\n## /);

    await assert.rejects(client.readResource({ uri: `${fabServer.KB_RESOURCE_PREFIX}NOPE-1` }));
  });

  it("keeps knowledge search local unless MCP_TARGET=cloud and a key is configured", () => {
    assert.equal(fabServer.resolveMcpTarget({}), "local");
    assert.equal(fabServer.resolveMcpTarget({ MCP_TARGET: "cloud" }), "local");
  });
});
