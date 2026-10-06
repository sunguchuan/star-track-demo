import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toObservationAttributes, toTraceAttributes } from "@/lib/ai/langfuse";
import {
  recordGuardrails,
  RunTrace,
  TRACE_PREVIEW_CHARS,
  traceGeneration,
  traceStream,
  type TraceSpan,
} from "@/lib/ai/trace";
import { buildWaterfall, summarizeTrace } from "@/lib/ai/trace-view";

const RUN_ID = "0F8E2C1A-1234-4ABC-9DEF-00112233AABB";
const PRICE = { inputPerM: 1, outputPerM: 2 };

async function* tokens(parts: string[], failAfter?: number) {
  for (const [index, part] of parts.entries()) {
    if (failAfter === index) throw new Error("socket hang up");
    yield part;
  }
}

describe("RunTrace", () => {
  it("uses the run id as a 32-hex trace id and links children to parents", () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    assert.equal(trace.id, "0f8e2c1a12344abc9def00112233aabb");
    const root = trace.start("ai.chat", "agent");
    const child = root.child("attempt.cloud", "span", { target: "cloud", model: "m" });
    assert.match(root.id, /^[0-9a-f]{16}$/);
    assert.equal(trace.spans[0].parentId, null);
    assert.equal(trace.spans[1].parentId, root.id);
    assert.equal(child.data.target, "cloud");
  });

  it("redacts and truncates inputs and outputs on the way in", () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const span = trace.start("x", "span", { input: "key sk-abcdefghijklmnopqrstuvwx please" });
    assert.ok(!span.data.input?.includes("sk-abc"));
    assert.ok(span.data.input?.includes("[REDACTED_API_KEY]"));
    span.end({ output: "a".repeat(TRACE_PREVIEW_CHARS + 10) });
    assert.ok(span.data.output?.endsWith("…(+10)"));
    assert.ok(span.ended);
  });

  it("prices cloud usage and keeps local usage free", () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const root = trace.start("root", "span");
    const cloud = root.child("llm", "generation", { target: "cloud" });
    const local = root.child("llm", "generation", { target: "local" });
    const forwarded: number[] = [];
    const sink = cloud.usageSink((u) => forwarded.push(u.promptTokens));
    sink({ promptTokens: 1_000_000, completionTokens: 0 });
    sink({ promptTokens: 0, completionTokens: 500_000 });
    local.addUsage({ promptTokens: 1000, completionTokens: 1000 });
    assert.deepEqual(cloud.data.usage, { promptTokens: 1_000_000, completionTokens: 500_000 });
    assert.equal(cloud.data.costUsd, 2);
    assert.equal(local.data.costUsd, 0);
    assert.deepEqual(forwarded, [1_000_000, 0]);
  });

  it("does not overwrite an ended span and closes leftovers as warnings", () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const root = trace.start("root", "span");
    const done = root.child("done", "span");
    root.child("open", "span");
    done.end({ output: "first" });
    done.fail(new Error("late"));
    assert.equal(done.data.status, "ok");
    assert.equal(done.data.output, "first");
    root.end();
    trace.close();
    const open = trace.spans.find((s) => s.name === "open");
    assert.equal(open?.status, "warning");
    assert.ok(open?.endedAt != null);
  });

  it("records guardrail passes as warnings only when something hit", () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const root = trace.start("root", "span");
    recordGuardrails(root, "guardrails.input", []);
    recordGuardrails(root, "guardrails.output", [{ rule: "output_secret", action: "warn" }]);
    const [, clean, hit] = trace.spans;
    assert.equal(clean.kind, "guardrail");
    assert.equal(clean.status, "ok");
    assert.equal(hit.status, "warning");
    assert.equal(hit.statusMessage, "output_secret:warn");
    assert.equal(hit.metadata?.hits, 1);
  });
});

describe("traceGeneration / traceStream", () => {
  it("ends a generation with its output, or fails it with the error code", async () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const root = trace.start("root", "span");
    const result = await traceGeneration(root, "llm.ok", {}, async () => ({ text: "hi" }), (r) => r.text);
    assert.equal(result.text, "hi");
    const failure = Object.assign(new Error("quota"), { code: "quota_exhausted" });
    await assert.rejects(traceGeneration(root, "llm.fail", {}, async () => Promise.reject(failure)));
    assert.equal(trace.spans[1].output, "hi");
    assert.equal(trace.spans[2].status, "error");
    assert.equal(trace.spans[2].statusMessage, "quota_exhausted: quota");
  });

  it("marks first token and collects the full output", async () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const span = trace.start("llm.chat", "generation");
    let text = "";
    for await (const part of traceStream(span, tokens(["Hel", "lo"]))) text += part;
    assert.equal(text, "Hello");
    assert.equal(span.data.output, "Hello");
    assert.equal(span.data.status, "ok");
    assert.ok(span.data.firstTokenAt != null);
  });

  it("keeps partial output when the consumer stops early", async () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const span = trace.start("llm.chat", "generation");
    for await (const part of traceStream(span, tokens(["a", "b", "c"]))) {
      if (part === "b") break;
    }
    assert.equal(span.data.output, "ab");
    assert.equal(span.data.status, "warning");
  });

  it("fails the span and rethrows when the stream errors", async () => {
    const trace = new RunTrace(RUN_ID, PRICE);
    const span = trace.start("llm.chat", "generation");
    await assert.rejects(async () => {
      for await (const part of traceStream(span, tokens(["a", "b"], 1))) void part;
    });
    assert.equal(span.data.status, "error");
    assert.equal(span.data.output, "a");
  });
});

function span(partial: Partial<TraceSpan> & Pick<TraceSpan, "id" | "startedAt">): TraceSpan {
  return {
    parentId: null,
    name: partial.id,
    kind: "span",
    endedAt: partial.startedAt,
    status: "ok",
    statusMessage: null,
    target: null,
    model: null,
    input: null,
    output: null,
    usage: null,
    costUsd: null,
    firstTokenAt: null,
    metadata: null,
    ...partial,
  };
}

describe("waterfall view", () => {
  const spans = [
    span({ id: "root", startedAt: 1000, endedAt: 2000 }),
    span({ id: "b", parentId: "root", startedAt: 1500, endedAt: 2000, kind: "generation", firstTokenAt: 1600, usage: { promptTokens: 10, completionTokens: 5 }, costUsd: 0.5 }),
    span({ id: "a", parentId: "root", startedAt: 1100, endedAt: 1200, kind: "tool", status: "error" }),
    span({ id: "a1", parentId: "a", startedAt: 1150, endedAt: 1160 }),
    span({ id: "orphan", parentId: "pruned", startedAt: 1900, endedAt: null, status: "warning" }),
  ];

  it("orders depth-first by start time and positions bars in the trace window", () => {
    const rows = buildWaterfall(spans);
    assert.deepEqual(rows.map((r) => [r.span.id, r.depth]), [
      ["root", 0],
      ["a", 1],
      ["a1", 2],
      ["b", 1],
      ["orphan", 0],
    ]);
    const b = rows.find((r) => r.span.id === "b")!;
    assert.equal(b.offsetPct, 50);
    assert.equal(b.widthPct, 50);
    assert.equal(b.ttftPct, 20);
    assert.equal(rows.find((r) => r.span.id === "orphan")!.durationMs, 0);
  });

  it("summarizes calls, tokens, cost and problems", () => {
    assert.deepEqual(summarizeTrace(spans), {
      startedAt: 1000,
      durationMs: 1000,
      spans: 5,
      llmCalls: 1,
      toolCalls: 1,
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.5,
      errors: 1,
      warnings: 1,
    });
    assert.equal(summarizeTrace([]), null);
  });
});

describe("Langfuse mapping", () => {
  const generation = span({
    id: "g",
    startedAt: 1000,
    endedAt: 3000,
    kind: "generation",
    target: "local",
    model: "qwen3:8b",
    input: "question",
    output: "answer",
    usage: { promptTokens: 100, completionTokens: 20 },
    costUsd: 0,
    firstTokenAt: 1500,
    status: "warning",
    statusMessage: "stream stopped early",
    metadata: { attempt: 1 },
  });

  it("maps generations with model, usage, explicit cost and first-token time", () => {
    const attrs = toObservationAttributes(generation, true);
    assert.equal(attrs.model, "qwen3:8b");
    assert.deepEqual(attrs.usageDetails, { input: 100, output: 20, total: 120 });
    assert.deepEqual(attrs.costDetails, { total: 0 });
    assert.equal(attrs.completionStartTime?.getTime(), 1500);
    assert.equal(attrs.level, "WARNING");
    assert.equal(attrs.statusMessage, "stream stopped early");
    assert.deepEqual(attrs.metadata, { attempt: 1, target: "local" });
    assert.equal(attrs.input, "question");
  });

  it("drops content when export of content is disabled", () => {
    const attrs = toObservationAttributes(generation, false);
    assert.equal(attrs.input, undefined);
    assert.equal(attrs.output, undefined);
    assert.equal(attrs.model, "qwen3:8b");
  });

  it("keeps the model of non-generation spans in metadata", () => {
    const attrs = toObservationAttributes(
      span({ id: "s", startedAt: 0, target: "cloud", model: "gemini", status: "error" }),
      true,
    );
    assert.equal(attrs.model, undefined);
    assert.equal(attrs.level, "ERROR");
    assert.deepEqual(attrs.metadata, { target: "cloud", model: "gemini" });
  });

  it("sets trace name, tags and metadata attributes", () => {
    assert.deepEqual(
      toTraceAttributes({ runId: RUN_ID, taskType: "investigate", status: "ok", tags: ["investigate", "cloud", "ok"] }),
      {
        "langfuse.trace.name": "ai.chat/investigate",
        "langfuse.trace.tags": ["investigate", "cloud", "ok"],
        "langfuse.trace.metadata.runId": RUN_ID,
        "langfuse.trace.metadata.status": "ok",
      },
    );
  });
});
