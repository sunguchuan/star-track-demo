import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { getSpecialist, listSpecialists } from "@/lib/ai/agents/specialists/registry";
import { RunTrace } from "@/lib/ai/trace";

describe("multi-agent specialists", () => {
  before(() => {
    process.chdir(mkdtempSync(join(tmpdir(), "agent-multi-test-")));
    delete process.env.AI_RAG;
  });

  it("registers data and procedure specialists with disjoint tool allowlists", () => {
    assert.deepEqual(
      listSpecialists().map((specialist) => specialist.id),
      ["data", "procedure"],
    );

    const data = getSpecialist("data");
    const procedure = getSpecialist("procedure");
    const dataTools = data.listTools().map((tool) => tool.name);
    const procedureTools = procedure.listTools().map((tool) => tool.name);

    assert.ok(dataTools.includes("get_fab_summary"));
    assert.ok(dataTools.includes("list_fab_alerts"));
    assert.ok(!dataTools.includes("search_fab_knowledge"));
    assert.deepEqual(procedureTools, ["search_fab_knowledge"]);
    assert.equal(data.policy?.topUpOpenAlerts, true);
    assert.equal(data.policy?.allowDirectReply, true);
    assert.equal(procedure.policy?.allowDirectReply, false);
  });

  it("keeps specialist prompts scoped to one job", () => {
    const data = getSpecialist("data");
    const procedure = getSpecialist("procedure");
    assert.match(data.createSystemPrompt("en"), /data specialist/i);
    assert.doesNotMatch(data.createSystemPrompt("en"), /search_fab_knowledge/);
    assert.match(procedure.createSystemPrompt("en"), /procedure specialist/i);
    assert.doesNotMatch(procedure.createSystemPrompt("en"), /list_fab_batches/);
  });

  it("nests coordinator → data / planner spans on a real run", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_RAG = "off";
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: unknown[];
        messages: { role: string; content: string | null }[];
      };
      const usage = { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 };
      if (body.tools) {
        return Response.json({
          usage,
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "get_fab_summary", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        usage,
        choices: [
          {
            message: {
              content: JSON.stringify({
                inScope: true,
                summary: "Summary",
                findings: [{ text: "Finding", refs: [] }],
                causes: [],
                actions: [{ text: "Act", priority: "P1", owner: "PE" }],
                dataToConfirm: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch;

    const { runInvestigateAgent } = await import("@/lib/ai/agents/investigate");
    const trace = new RunTrace("multi-agent-test");
    const root = trace.start("investigate", "agent");
    for await (const event of runInvestigateAgent({
      target: "cloud",
      model: "fast-model",
      userInput: "B7 yield drop — draft an action plan",
      signal: new AbortController().signal,
      span: root,
    })) {
      void event;
    }
    root.end();

    const names = trace.spans.map((span) => span.name);
    assert.ok(names.includes("agent.coordinator"));
    assert.ok(names.includes("agent.data"));
    assert.ok(names.includes("agent.planner"));
    assert.ok(!names.includes("agent.procedure"), "procedure skipped when AI_RAG=off");
    const coordinator = trace.spans.find((span) => span.name === "agent.coordinator");
    assert.equal(coordinator?.metadata?.workflow, "langgraph");
  });
});
