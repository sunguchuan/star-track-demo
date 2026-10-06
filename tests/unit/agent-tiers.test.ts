import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import type { StreamEvent } from "@/lib/ai/types";

const STANDARD = "fast-model";
const STRONG = "strong-model";

const plan = (ref: string) =>
  JSON.stringify({
    inScope: true,
    summary: "B7 yield dropped",
    findings: [{ text: "Batch below control limit", refs: [ref] }],
    causes: [],
    actions: [{ text: "Inspect chamber", priority: "P0", owner: "Equipment engineer" }],
    dataToConfirm: [],
  });

/** Per-model reply for the JSON plan call; a number is an HTTP error status. */
let planReplies: Record<string, string | number> = {};
let calls: { model: string; kind: "tools" | "plan"; system: string; lastUser: string; toolResults: string[] }[] = [];

let runInvestigateAgent: typeof import("@/lib/ai/agent").runInvestigateAgent;

before(async () => {
  process.chdir(mkdtempSync(join(tmpdir(), "agent-tiers-test-")));
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      tools?: unknown[];
      messages: { role: string; content: string | null }[];
    };
    const kind = body.tools ? "tools" : "plan";
    calls.push({
      model: body.model,
      kind,
      system: body.messages[0].content ?? "",
      lastUser: body.messages.at(-1)?.content ?? "",
      toolResults: body.messages.filter((m) => m.content?.startsWith("<tool_result")).map((m) => m.content ?? ""),
    });
    const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
    if (kind === "tools") {
      return Response.json({
        usage,
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "get_fab_batch", arguments: '{"batchId":"B-240909-01"}' } },
              ],
            },
          },
        ],
      });
    }
    const reply = planReplies[body.model];
    if (typeof reply === "number") return new Response("model overloaded", { status: reply });
    return Response.json({ usage, choices: [{ message: { content: reply } }] });
  }) as typeof fetch;
  ({ runInvestigateAgent } = await import("@/lib/ai/agent"));
});

beforeEach(() => {
  calls = [];
  delete process.env.AI_PROMPT_COMPRESSION;
});

async function run(options: { planModel?: string; escalationModel?: string }) {
  const events: StreamEvent[] = [];
  const usageModels: (string | null | undefined)[] = [];
  for await (const event of runInvestigateAgent({
    target: "cloud",
    model: STANDARD,
    userInput: "B7 batch B-240909-01 为什么良率低？",
    signal: new AbortController().signal,
    onUsage: (_usage, model) => usageModels.push(model),
    ...options,
  })) {
    events.push(event);
  }
  const metas = events.filter((e): e is Extract<StreamEvent, { type: "meta" }> => e.type === "meta");
  const planEvent = events.find((e): e is Extract<StreamEvent, { type: "plan" }> => e.type === "plan");
  return { events, metas, planEvent, usageModels };
}

describe("investigate agent model tiers", () => {
  it("escalates an ungrounded standard plan to the strong model", async () => {
    planReplies = { [STANDARD]: plan("ETCH-FAKE-999"), [STRONG]: plan("ETCH-YIELD-DROP") };
    const { metas, planEvent, usageModels } = await run({ escalationModel: STRONG });
    assert.deepEqual(calls.map((c) => `${c.kind}:${c.model}`), [
      `tools:${STANDARD}`,
      `plan:${STANDARD}`,
      `plan:${STRONG}`,
    ]);
    assert.equal(metas.length, 1);
    assert.equal(metas[0].escalated, true);
    assert.equal(metas[0].model, STRONG);
    assert.deepEqual(planEvent?.ungroundedRefs, []);
    assert.deepEqual(usageModels, [STANDARD, STANDARD, STRONG]);
  });

  it("keeps the standard plan when the strong model does no better", async () => {
    planReplies = { [STANDARD]: plan("ETCH-FAKE-999"), [STRONG]: plan("ETCH-FAKE-111") };
    const { metas, planEvent } = await run({ escalationModel: STRONG });
    assert.deepEqual(metas.map((m) => m.model), [STRONG, STANDARD]);
    assert.deepEqual(planEvent?.ungroundedRefs, ["ETCH-FAKE-999"]);
  });

  it("does not escalate a grounded plan", async () => {
    planReplies = { [STANDARD]: plan("ETCH-YIELD-DROP") };
    const { metas } = await run({ escalationModel: STRONG });
    assert.equal(metas.length, 0);
    assert.equal(calls.filter((c) => c.model === STRONG).length, 0);
  });

  it("uses the strong model only for the plan, and downgrades when it is unavailable", async () => {
    planReplies = { [STRONG]: 503, [STANDARD]: plan("ETCH-YIELD-DROP") };
    const { metas, planEvent } = await run({ planModel: STRONG });
    assert.equal(calls[0].model, STANDARD, "tool selection stays on the standard model");
    assert.equal(calls.filter((c) => c.kind === "plan" && c.model === STRONG).length, 2, "one transport retry");
    assert.equal(metas.length, 1);
    assert.equal(metas[0].model, STANDARD);
    assert.ok(planEvent);
  });

  it("sends compact tool results and a trimmed plan prompt unless compression is off", async () => {
    planReplies = { [STANDARD]: plan("ETCH-YIELD-DROP") };
    await run({});
    const compact = calls.find((c) => c.kind === "plan");
    assert.ok(compact);
    assert.match(compact.toolResults[0], /same for all rows: .*toolId=T-ETCH-07/);
    assert.doesNotMatch(compact.system, /You get one tool round/);
    assert.doesNotMatch(compact.lastUser, /Shape:/);

    calls = [];
    process.env.AI_PROMPT_COMPRESSION = "off";
    await run({});
    const full = calls.find((c) => c.kind === "plan");
    assert.ok(full);
    assert.match(full.toolResults[0], /"toolId":"T-ETCH-07"/);
    assert.match(full.system, /You get one tool round/);
    assert.match(full.lastUser, /Shape:/);
  });
});
