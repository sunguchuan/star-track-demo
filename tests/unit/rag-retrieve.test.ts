import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, before, describe, it } from "node:test";
import { RunTrace } from "@/lib/ai/trace";
import { buildCorpus } from "@/lib/rag/corpus";
import { retrieve, type RetrievalOptions } from "@/lib/rag/retrieve";

const doc = (id: string, type: string, codes: string, sections: Record<string, string>) => ({
  name: `${id}.md`,
  source: [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `type: ${type}`,
    `codes: ${codes}`,
    "---",
    ...Object.entries(sections).flatMap(([heading, text]) => [`## ${heading}`, "", text, ""]),
  ].join("\n"),
});

const corpus = buildCorpus([
  doc("RB-PARTICLE", "runbook", "ETCH-PARTICLE", {
    立即动作: "颗粒超标时暂停批次并安排湿法清洁。",
    放行标准: "颗粒测试片新增颗粒少于 10 颗。",
  }),
  doc("SOP-CLEAN", "sop", "", { 作业步骤: "复装后测漏率，必须低于 2 mTorr/min。" }),
  doc("INC-RF", "incident", "ETCH-RF-DRIFT", { 根因: "RF 匹配网络电容老化导致反射功率升高。" }),
]);

/** Fake embedding space: one axis per topic, everything else on a shared "other" axis. */
const TOPICS: [RegExp, number][] = [
  [/颗粒|particle/i, 0],
  [/漏率|leak/i, 1],
  [/RF|反射功率/, 2],
];
function fakeVector(prompt: string): number[] {
  const text = prompt.replace(/^task: [^|]+\| query: /, "").replace(/^title: [^|]+\| text: /, "");
  const v = [0, 0, 0, 0.05];
  for (const [pattern, axis] of TOPICS) if (pattern.test(text)) v[axis] = 1;
  if (v.slice(0, 3).every((x) => x === 0)) v[3] = 1;
  return v;
}

let embedFails = false;
let rerankFails = false;
let rerankScores: number[] = [];
let rerankCalls = 0;

before(() => {
  process.chdir(mkdtempSync(join(tmpdir(), "rag-retrieve-test-")));
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url).endsWith("/api/embed")) {
      if (embedFails) throw new TypeError("fetch failed");
      const input = body.input as string | string[];
      const prompts = Array.isArray(input) ? input : [input];
      return Response.json({ model: body.model, embeddings: prompts.map(fakeVector), prompt_eval_count: 5 });
    }
    if (String(url).endsWith("/chat/completions")) {
      rerankCalls += 1;
      if (rerankFails) return new Response("upstream error", { status: 500 });
      const content = JSON.stringify({ scores: rerankScores.map((score, i) => ({ id: `P${i + 1}`, score })) });
      return Response.json({
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as typeof fetch;
});

afterEach(() => {
  embedFails = false;
  rerankFails = false;
  rerankScores = [];
  rerankCalls = 0;
  delete process.env.OPENAI_API_KEY;
});

const run = (query: string, options: Partial<RetrievalOptions> = {}) =>
  retrieve({ query, corpus, embed: { localRuntime: true, cloudAvailable: false }, ...options });

describe("retrieve", () => {
  it("finds a cross-lingual match through vectors when BM25 has nothing, and records each stage", async () => {
    const trace = new RunTrace("rag-test");
    const result = await run("wafer particle count too high", { span: trace.start("root", "span") });

    assert.equal(result.mode, "hybrid");
    assert.equal(result.embedModel, "embeddinggemma");
    assert.deepEqual(result.stages.bm25, []);
    assert.deepEqual(new Set(result.hits.map((h) => h.docId)), new Set(["RB-PARTICLE"]));
    assert.deepEqual(result.hits[0].matchedBy, ["vector"]);

    const names = trace.spans.map((s) => s.name);
    for (const name of ["rag.retrieve", "rag.bm25", "embed", "rag.index", "rag.vector", "rag.fuse"]) {
      assert.ok(names.includes(name), name);
    }
  });

  it("ranks a section first when both retrievers agree on it", async () => {
    const result = await run("测漏率必须低于多少");
    assert.equal(result.hits[0].sectionId, "SOP-CLEAN#作业步骤");
    assert.deepEqual(result.hits[0].matchedBy, ["bm25", "vector"]);
  });

  it("without a reranker, drops vector-only sections below the similarity floor", async () => {
    const result = await run("食堂几点开饭");
    assert.ok(result.stages.fused.length > 0);
    assert.equal(result.similarityFloor, 0.45);
    assert.deepEqual(result.hits, []);
  });

  it("falls back to BM25 when embeddings are unavailable", async () => {
    embedFails = true;
    const result = await run("测漏率必须低于多少");
    assert.equal(result.mode, "bm25");
    assert.ok(result.vectorError);
    assert.equal(result.hits[0].sectionId, "SOP-CLEAN#作业步骤");
  });

  it("reorders by reranker score and cuts passages below relevance 2", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const first = await run("wafer particle count too high");
    rerankScores = first.stages.fused.map((_, i) => (i === 1 ? 3 : i === 0 ? 1 : 0));

    const result = await run("wafer particle count too high", { rerankModel: "rerank-model" });
    assert.equal(rerankCalls, 1);
    assert.equal(result.rerankModel, "rerank-model");
    assert.deepEqual(
      result.hits.map((h) => [h.sectionId, h.relevance]),
      [[first.stages.fused[1].sectionId, 3]],
    );
  });

  it("abstains when the reranker finds nothing relevant", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    rerankScores = [0, 1, 0, 0];
    const result = await run("颗粒", { rerankModel: "rerank-model" });
    assert.ok(result.stages.rerank);
    assert.deepEqual(result.hits, []);
  });

  it("uses the fused ranking when the reranker fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    rerankFails = true;
    const result = await run("测漏率必须低于多少", { rerankModel: "rerank-model" });
    assert.ok(result.rerankError);
    assert.equal(result.stages.rerank, null);
    assert.equal(result.hits[0].sectionId, "SOP-CLEAN#作业步骤");
  });

  it("filters by metadata, and relaxes a filter that matches no document", async () => {
    const sopOnly = await run("测漏率必须低于多少 颗粒", { filter: { docType: "sop" } });
    assert.deepEqual([...new Set(sopOnly.hits.map((h) => h.docId))], ["SOP-CLEAN"]);
    assert.equal(sopOnly.filterRelaxed, false);

    const relaxed = await run("颗粒超标", { filter: { alertCode: "NO-SUCH-CODE" } });
    assert.equal(relaxed.filterRelaxed, true);
    assert.equal(relaxed.hits[0].docId, "RB-PARTICLE");
  });
});
