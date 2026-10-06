import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import { buildCacheContext, type CacheMode } from "@/lib/ai/cache-keys";
import { normalize, type Embedding } from "@/lib/ai/embeddings";
import { evictForRun, lookupAnswer, rememberAnswer } from "@/lib/ai/semantic-cache";
import { getRunsDb } from "@/lib/ai/runs";
import { RunTrace } from "@/lib/ai/trace";
import type { AiStrategy, AiTaskType } from "@/lib/ai/types";

/** Fake embedding space: paraphrases share a direction, B9 is identical to B7 on purpose. */
const VECTORS: Record<string, number[]> = {
  "B7 良率为什么下降？": [1, 0, 0],
  "B7 良率下滑的原因是什么": [0.97, 0.24, 0],
  "B9 良率为什么下降？": [1, 0, 0],
  "今天食堂吃什么": [0, 0, 1],
};

let embedCalls = 0;
let embedFails = false;

before(() => {
  process.chdir(mkdtempSync(join(tmpdir(), "semantic-cache-test-")));
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    embedCalls += 1;
    if (embedFails) throw new TypeError("fetch failed");
    const { input, model } = JSON.parse(String(init?.body)) as { input: string; model: string };
    const text = input.replace(/^task: sentence similarity \| query: /, "");
    const values = VECTORS[text];
    assert.ok(values, `no fake vector for ${text}`);
    return Response.json({ model, embeddings: [values], prompt_eval_count: 8 });
  }) as typeof fetch;
});

beforeEach(() => {
  getRunsDb().exec("DELETE FROM ai_cache");
  embedCalls = 0;
  embedFails = false;
  delete process.env.AI_CACHE_TTL_HOURS;
});

function context(
  input: string,
  options: { mode?: CacheMode; taskType?: AiTaskType; strategy?: AiStrategy } = {},
) {
  return buildCacheContext({
    mode: options.mode ?? "semantic",
    taskType: options.taskType ?? "investigate",
    input,
    history: [],
    strategy: options.strategy ?? "auto",
    dataVersion: "v-test",
  });
}

function lookup(input: string, options: Parameters<typeof context>[1] & { bypass?: boolean } = {}) {
  const trace = new RunTrace("lookup");
  return lookupAnswer({
    context: context(input, options),
    input,
    bypass: options.bypass ?? false,
    localRuntime: true,
    cloudAvailable: false,
    signal: new AbortController().signal,
    parent: trace.start("root", "span"),
  });
}

function embedding(input: string): Embedding {
  return { model: "embeddinggemma", target: "local", vector: normalize(VECTORS[input]), promptTokens: 8 };
}

function remember(
  input: string,
  options: Parameters<typeof context>[1] & {
    runId?: string;
    target?: "local" | "cloud";
    output?: string;
    replaceSimilar?: boolean;
  } = {},
) {
  const ctx = context(input, options);
  rememberAnswer({
    context: ctx,
    embedding: ctx.mode === "semantic" ? embedding(input) : null,
    input,
    target: options.target ?? "local",
    model: "qwen3:8b",
    output: options.output ?? `answer to ${input}`,
    plan: null,
    sourceRunId: options.runId ?? "run-1",
    sourceMs: 12_000,
    sourceCostUsd: 0.002,
    replaceSimilar: options.replaceSimilar ?? false,
    parent: new RunTrace("store").start("root", "span"),
  });
}

const count = () =>
  (getRunsDb().prepare("SELECT COUNT(*) AS n FROM ai_cache").get() as { n: number }).n;

describe("semantic cache store", () => {
  it("exact mode: identical input hits without embedding; bypass skips the lookup", async () => {
    remember("hello world", { mode: "exact", taskType: "summarize" });
    const hit = await lookup("hello world", { mode: "exact", taskType: "summarize" });
    assert.equal(hit.hit?.output, "answer to hello world");
    assert.equal(hit.hit?.similarity, null);
    assert.equal(hit.hit?.sourceMs, 12_000);
    assert.equal(embedCalls, 0);

    assert.equal((await lookup("hello world!", { mode: "exact", taskType: "summarize" })).hit, null);
    assert.equal((await lookup("hello world", { mode: "exact", taskType: "polish" })).hit, null);
    assert.equal((await lookup("hello world", { mode: "exact", taskType: "summarize", bypass: true })).hit, null);
  });

  it("semantic mode: serves a paraphrase, not a different tool with the same vector", async () => {
    remember("B7 良率为什么下降？");
    const paraphrase = await lookup("B7 良率下滑的原因是什么");
    assert.equal(paraphrase.hit?.output, "answer to B7 良率为什么下降？");
    assert.ok(paraphrase.hit!.similarity! > 0.95);
    assert.ok(paraphrase.embedding, "embedding is returned for reuse on store");

    const otherTool = await lookup("B9 良率为什么下降？");
    assert.equal(otherTool.hit, null);
    assert.equal((await lookup("今天食堂吃什么")).hit, null);
  });

  it("respects the strategy: a cloud answer is not served to only-local", async () => {
    remember("B7 良率为什么下降？", { target: "cloud" });
    assert.equal((await lookup("B7 良率为什么下降？", { strategy: "only-local" })).hit, null);
    assert.ok((await lookup("B7 良率为什么下降？", { strategy: "only-cloud" })).hit);
  });

  it("regenerate replaces the similar entry instead of adding a duplicate", async () => {
    remember("B7 良率为什么下降？", { output: "old" });
    const bypass = await lookup("B7 良率下滑的原因是什么", { bypass: true });
    assert.equal(bypass.hit, null);
    assert.ok(bypass.embedding);
    remember("B7 良率下滑的原因是什么", { output: "new", replaceSimilar: true, runId: "run-2" });
    assert.equal(count(), 1);
    assert.equal((await lookup("B7 良率为什么下降？")).hit?.output, "new");
  });

  it("negative feedback evicts the answers a run produced", async () => {
    remember("B7 良率为什么下降？", { runId: "bad-run" });
    remember("hello", { mode: "exact", taskType: "summarize", runId: "good-run" });
    assert.equal(evictForRun("bad-run"), 1);
    assert.equal((await lookup("B7 良率为什么下降？")).hit, null);
    assert.equal(count(), 1);
  });

  it("expired entries are not served", async () => {
    process.env.AI_CACHE_TTL_HOURS = String(1 / 3_600_000);
    remember("B7 良率为什么下降？");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await lookup("B7 良率为什么下降？")).hit, null);
  });

  it("an embedding failure degrades to a miss", async () => {
    remember("B7 良率为什么下降？");
    embedFails = true;
    const result = await lookup("B7 良率为什么下降？");
    assert.equal(result.hit, null);
    assert.equal(result.embedding, null);
  });
});
