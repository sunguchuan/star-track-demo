import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { StreamEvent } from "@/lib/ai/types";

/** Replies gemini-3.1-flash-lite gave on /fab, from the run traces. */
const IDENTITY_EN =
  "I am a semiconductor fab manufacturing co-pilot. I am here to assist you with production-line investigations, including analyzing batch data, monitoring alerts, and retrieving relevant SOPs or runbooks from the knowledge base. Please let me know how I can assist with your current fab operations.";
const REFUSAL_EN =
  "I only provide assistance for production-line and semiconductor fab manufacturing investigations. Please let me know if you have any questions regarding batch statuses, yields, or active alerts.";

let agent: typeof import("@/lib/ai/agent");
let firstReply = "";
let toolCallsPerformed = 0;

before(async () => {
  process.chdir(mkdtempSync(join(tmpdir(), "agent-direct-reply-test-")));
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { tools?: unknown[] };
    if (!body.tools) toolCallsPerformed++;
    const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
    return Response.json({ usage, choices: [{ message: { content: firstReply } }] });
  }) as typeof fetch;
  agent = await import("@/lib/ai/agent");
});

describe("isDirectReply", () => {
  it("passes refusals and identity answers through in both languages", () => {
    assert.ok(agent.isDirectReply(IDENTITY_EN, "en"));
    assert.ok(agent.isDirectReply(REFUSAL_EN, "en"));
    assert.ok(agent.isDirectReply("我只处理产线排查相关的问题，例如批次良率、告警和处置流程。", "zh"));
    assert.ok(agent.isDirectReply("Which batch do you mean? Please give me the batch ID.", "en"));
    assert.ok(agent.isDirectReply("I can't tell the cause because I have no data yet.", "en"), "'because' is not a section");
  });

  it("forces data when the reply makes claims it never looked up", () => {
    assert.equal(agent.isDirectReply("B-240909-01 yield dropped to 89.4%.", "en"), false);
    assert.equal(agent.isDirectReply("ETCH-RF-DRIFT is the likely trigger.", "en"), false);
    assert.equal(agent.isDirectReply("T-ETCH-07 needs a chamber clean.", "en"), false);
  });

  it("forces data for a plan written without tools", () => {
    assert.equal(agent.isDirectReply("1. Symptoms: yield is low\n2. Likely causes: chamber drift", "en"), false);
    assert.equal(agent.isDirectReply("现象：良率偏低\n可能原因：腔体漂移", "zh"), false);
    assert.equal(agent.isDirectReply("x".repeat(600), "en"), false);
    assert.equal(agent.isDirectReply("良".repeat(200), "zh"), false);
    assert.equal(agent.isDirectReply("", "en"), false);
  });
});

describe("investigate agent on an identity question", () => {
  it("answers directly without pulling fab data", async () => {
    firstReply = IDENTITY_EN;
    toolCallsPerformed = 0;
    const events: StreamEvent[] = [];
    for await (const event of agent.runInvestigateAgent({
      target: "cloud",
      model: "fast-model",
      userInput: "Who am I?",
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }
    assert.deepEqual(events, [{ type: "delta", text: IDENTITY_EN }]);
    assert.equal(toolCallsPerformed, 0, "no plan call after a direct reply");
  });
});
