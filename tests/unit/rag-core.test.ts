import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectReplyLanguage } from "@/lib/ai/language";
import { renderKnowledge } from "@/lib/ai/tools/knowledge";
import { Bm25Index, tokenize } from "@/lib/rag/bm25";
import {
  buildCorpus,
  chunkDoc,
  chunkSection,
  CHILD_MAX_CHARS,
  KB_LANGS,
  kbDir,
  loadCorpus,
  localizeDoc,
  localizeSection,
  parseKbDoc,
} from "@/lib/rag/corpus";
import { hitAt, ndcgAt, recallAt, reciprocalRank } from "@/lib/rag/metrics";
import { parseRerankScores } from "@/lib/rag/rerank";
import {
  localizeHits,
  poolSections,
  reciprocalRankFusion,
  RRF_K,
  similarityFloor,
  type RetrievalResult,
} from "@/lib/rag/retrieve";

describe("tokenize", () => {
  it("keeps alert codes whole and also indexes their parts", () => {
    const tokens = tokenize("ETCH-RF-DRIFT 告警");
    assert.ok(tokens.includes("etch-rf-drift"));
    for (const part of ["etch", "rf", "drift", "告警"]) assert.ok(tokens.includes(part), part);
  });

  it("splits Chinese into overlapping bigrams", () => {
    assert.deepEqual(tokenize("湿法清洁"), ["湿法", "法清", "清洁"]);
  });

  it("drops English stopwords and normalizes full-width characters", () => {
    assert.deepEqual(tokenize("What is the leak rate"), ["leak", "rate"]);
    assert.deepEqual(tokenize("ＣＦ４"), ["cf4"]);
  });
});

describe("Bm25Index", () => {
  const index = new Bm25Index([
    { id: "particle", text: "ETCH-PARTICLE 颗粒超标 暂停批次 湿法清洁" },
    { id: "rf", text: "ETCH-RF-DRIFT 射频功率漂移 校准" },
    { id: "clean", text: "湿法清洁 漏率 低于 2 mTorr/min" },
  ]);

  it("ranks the chunk with the exact alert code first", () => {
    assert.equal(index.search("ETCH-RF-DRIFT 怎么处理", 3)[0].id, "rf");
  });

  it("returns nothing when no query term is in the vocabulary", () => {
    assert.deepEqual(index.search("cafeteria opening hours", 3), []);
  });

  it("minShouldMatch drops chunks that share only a word or two with the query", () => {
    const query = "颗粒超标后要不要湿法清洁";
    assert.ok(index.search(query, 3).some((h) => h.id === "clean"));
    const strict = index.search(query, 3, undefined, 0.3).map((h) => h.id);
    assert.deepEqual(strict, ["particle"]);
  });

  it("applies the filter before scoring", () => {
    assert.deepEqual(
      index.search("湿法清洁", 3, (id) => id !== "particle").map((h) => h.id),
      ["clean"],
    );
  });
});

describe("corpus chunking", () => {
  const source = [
    "---",
    "id: SOP-TEST-001",
    "title: 测试作业程序",
    "type: sop",
    "codes: ETCH-PARTICLE, ETCH-RF-DRIFT",
    "---",
    "",
    "## 步骤",
    "",
    "1. 第一步。",
    "2. 第二步。",
    "",
    "## Release",
    "",
    "Particles must stay below 10. Two wafers in a row must pass.",
  ].join("\n");

  it("parses front matter and one section per ## heading", () => {
    const doc = parseKbDoc(source, "fallback");
    assert.equal(doc.id, "SOP-TEST-001");
    assert.deepEqual(doc.codes, ["ETCH-PARTICLE", "ETCH-RF-DRIFT"]);
    assert.deepEqual(doc.sections.map((s) => s.id), ["SOP-TEST-001#步骤", "SOP-TEST-001#Release"]);
  });

  it("children carry the contextual header and point to their parent section", () => {
    const chunks = chunkDoc(parseKbDoc(source, "fallback"));
    assert.equal(chunks[0].id, "SOP-TEST-001#步骤:0");
    assert.equal(chunks[0].header, "测试作业程序 › 步骤");
    assert.equal(chunks[0].sectionId, "SOP-TEST-001#步骤");
  });

  it("packs units up to the limit and splits English sentences", () => {
    assert.deepEqual(chunkSection("1. 第一步。\n2. 第二步。", 100), ["1. 第一步。\n2. 第二步。"]);
    assert.deepEqual(chunkSection("One sentence here. Another one there.", 20), [
      "One sentence here.",
      "Another one there.",
    ]);
    const long = "很长".repeat(200);
    assert.deepEqual(chunkSection(long, 50), [long]);
  });

  it("the content hash changes when a chunk's text changes", () => {
    const a = buildCorpus([{ name: "a.md", source }]);
    const b = buildCorpus([{ name: "a.md", source: source.replace("第一步", "第 1 步") }]);
    assert.notEqual(a.chunks[0].hash, b.chunks[0].hash);
    assert.equal(a.chunks.at(-1)!.hash, b.chunks.at(-1)!.hash);
    assert.notEqual(a.version, b.version);
  });
});

describe("knowledge base files", () => {
  const corpus = loadCorpus();

  it("every document has a citable, unique ID and at least one section", () => {
    const ids = corpus.docs.map((d) => d.id);
    assert.ok(ids.length >= 10);
    assert.equal(new Set(ids).size, ids.length);
    for (const doc of corpus.docs) {
      assert.match(doc.id, /^[A-Z][A-Z0-9-]{1,39}$/, doc.id);
      assert.ok(doc.sections.length > 0, doc.id);
    }
  });

  it("children stay within the size limit unless a single unit is longer", () => {
    for (const chunk of corpus.chunks) {
      if (chunk.text.includes("\n")) assert.ok(chunk.text.length <= CHILD_MAX_CHARS, chunk.id);
    }
  });

  it("every gold label in evals/rag-queries.json points at an existing section", () => {
    const gold = JSON.parse(readFileSync("evals/rag-queries.json", "utf8")) as {
      queries: { id: string; relevant: string[] }[];
    };
    for (const q of gold.queries) {
      for (const id of q.relevant) assert.ok(corpus.sections.has(id), `${q.id}: ${id}`);
    }
  });

  it("every document is translated into the other language and no translation file is dropped", () => {
    const files = KB_LANGS.flatMap((lang) => {
      const dir = join(kbDir(), "i18n", lang);
      return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")) : [];
    });
    const loaded = [...corpus.translations.values()].reduce((n, t) => n + Object.keys(t).length, 0);
    assert.equal(loaded, files.length, "a translation whose sections do not line up is ignored");
    for (const doc of corpus.docs) {
      const own = detectReplyLanguage(doc.sections.map((s) => s.text).join("\n"));
      const other = own === "zh" ? "en" : "zh";
      assert.ok(corpus.translations.get(doc.id)?.[other], `${doc.id} has no ${other} translation`);
    }
  });

  it("translations keep every number and code of the source section", () => {
    // Month numbers become month names in English ("2026 年 6 月" → "June 2026").
    const numbers = (text: string) => new Set(text.replace(/\d+\s*月/g, "").match(/\d+(?:\.\d+)?/g) ?? []);
    const codes = (text: string) => new Set(text.match(/[A-Z]{2,}(?:-[A-Z0-9]+)+/g) ?? []);
    for (const section of corpus.sections.values()) {
      for (const lang of KB_LANGS) {
        if (!corpus.translations.get(section.docId)?.[lang]) continue;
        const translated = localizeSection(corpus, section, lang);
        const where = `${section.id} → ${lang}`;
        const kept = numbers(translated.text);
        for (const n of numbers(section.text)) assert.ok(kept.has(n), `${where}: missing ${n}`);
        assert.deepEqual(codes(translated.text), codes(section.text), where);
      }
    }
  });
});

describe("translations", () => {
  const source = (title: string, sections: string[]) =>
    ["---", "id: SOP-T-1", `title: ${title}`, "type: sop", "---", "", ...sections].join("\n");
  const zh = source("测试程序", ["## 步骤", "", "颗粒少于 10 颗。", "", "## 放行", "", "连续 2 片合格。"]);
  const en = source("Test procedure", ["## Steps", "", "Fewer than 10 particles.", "", "## Release", "", "2 wafers in a row."]);

  it("lines sections up by position and keeps the source for retrieval", () => {
    const corpus = buildCorpus([{ name: "SOP-T-1.md", source: zh }], [{ name: "SOP-T-1.md", source: en, lang: "en" }]);
    const release = corpus.sections.get("SOP-T-1#放行")!;
    assert.deepEqual(localizeSection(corpus, release, "en"), {
      docTitle: "Test procedure",
      heading: "Release",
      text: "2 wafers in a row.",
      translated: true,
    });
    assert.equal(localizeSection(corpus, release, "zh").translated, false);
    assert.ok(corpus.chunks.every((c) => !c.text.includes("wafers")), "translations are not indexed");
    assert.notEqual(corpus.version, buildCorpus([{ name: "SOP-T-1.md", source: zh }]).version);
  });

  it("ignores a translation whose sections do not line up", () => {
    const partial = source("Test procedure", ["## Steps", "", "Fewer than 10 particles."]);
    const corpus = buildCorpus([{ name: "SOP-T-1.md", source: zh }], [{ name: "x.md", source: partial, lang: "en" }]);
    assert.equal(corpus.translations.size, 0);
    const doc = corpus.docs[0];
    assert.deepEqual(localizeDoc(corpus, doc, "en"), { title: "测试程序", headings: ["步骤", "放行"] });
  });

  it("localizeHits translates hits and leaves untranslated ones as they are", () => {
    const corpus = buildCorpus([{ name: "SOP-T-1.md", source: zh }], [{ name: "SOP-T-1.md", source: en, lang: "en" }]);
    const hit = {
      sectionId: "SOP-T-1#步骤",
      docId: "SOP-T-1",
      docTitle: "测试程序",
      heading: "步骤",
      type: "sop" as const,
      text: "颗粒少于 10 颗。",
      matchedBy: ["vector" as const],
      fusedRank: 1,
      relevance: 3,
    };
    const [translated, unknown] = localizeHits([hit, { ...hit, sectionId: "X#y" }], "en", corpus);
    assert.equal(translated.heading, "Steps");
    assert.equal(translated.relevance, 3);
    assert.equal(unknown.heading, "步骤");
    assert.equal(unknown.translated, false);
  });
});

describe("fusion", () => {
  it("max-pools children into sections in rank order", () => {
    const pooled = poolSections(
      [
        { chunkId: "A#x:1", score: 0.9 },
        { chunkId: "B#y:0", score: 0.8 },
        { chunkId: "A#x:0", score: 0.7 },
      ],
      (id) => id.slice(0, id.lastIndexOf(":")),
    );
    assert.deepEqual(pooled, [
      { sectionId: "A#x", score: 0.9 },
      { sectionId: "B#y", score: 0.8 },
    ]);
  });

  it("RRF rewards agreement between retrievers without comparing their scores", () => {
    const bm25 = [{ sectionId: "only-bm25", score: 25 }, { sectionId: "both", score: 3 }];
    const vector = [{ sectionId: "only-vector", score: 0.9 }, { sectionId: "both", score: 0.8 }];
    const fused = reciprocalRankFusion([bm25, vector]);
    assert.equal(fused[0].sectionId, "both");
    assert.equal(fused[0].score, 2 / (RRF_K + 2));
  });
});

describe("metrics", () => {
  const ranked = ["x", "a", "y", "b"];
  const relevant = ["a", "b"];

  it("Hit@k / Recall@k / MRR", () => {
    assert.equal(hitAt(ranked, relevant, 1), 0);
    assert.equal(hitAt(ranked, relevant, 2), 1);
    assert.equal(recallAt(ranked, relevant, 3), 0.5);
    assert.equal(recallAt(ranked, relevant, 4), 1);
    assert.equal(reciprocalRank(ranked, relevant), 0.5);
  });

  it("nDCG is 1 for the ideal order and lower when relevant items sink", () => {
    assert.equal(ndcgAt(["a", "b", "x"], relevant, 3), 1);
    const expected = (1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3));
    assert.ok(Math.abs(ndcgAt(ranked, relevant, 5) - expected) < 1e-12);
  });
});

describe("parseRerankScores", () => {
  it("maps passage ids to candidate order, clamps to 0–3 and defaults missing ones to 0", () => {
    const raw = '```json\n{"scores":[{"id":"P2","score":3},{"id":"[P1]","score":7},{"id":"P9","score":3}]}\n```';
    assert.deepEqual(parseRerankScores(raw, 3), [3, 3, 0]);
  });

  it("throws on non-JSON so the pipeline falls back to the fused ranking", () => {
    assert.throws(() => parseRerankScores("P1 is best", 2));
  });
});

describe("similarityFloor", () => {
  it("applies only to calibrated embedding models, ignoring the Ollama tag", () => {
    assert.equal(similarityFloor("embeddinggemma:latest"), similarityFloor("embeddinggemma"));
    assert.ok(similarityFloor("embeddinggemma")! > 0);
    assert.equal(similarityFloor("gemini-embedding-001"), null);
    assert.equal(similarityFloor(null), null);
  });
});

describe("renderKnowledge", () => {
  const base: RetrievalResult = {
    query: "q",
    filter: {},
    filterRelaxed: false,
    requestedMode: "hybrid",
    mode: "hybrid",
    embedModel: "embeddinggemma",
    vectorError: null,
    rerankModel: null,
    rerankError: null,
    similarityFloor: 0.45,
    stages: { bm25: [], vector: [], fused: [], rerank: null },
    hits: [],
    ms: 1,
  };

  it("tells the model not to cite anything when nothing was found", () => {
    assert.match(renderKnowledge(base), /no relevant document/);
  });

  it("numbers passages under their document ID and warns when not reranked", () => {
    const hit = {
      sectionId: "SOP-ETCH-012#放行检查",
      docId: "SOP-ETCH-012",
      docTitle: "湿法清洁",
      heading: "放行检查",
      type: "sop" as const,
      text: "颗粒少于 10 颗。",
      matchedBy: ["vector" as const],
      fusedRank: 1,
      relevance: null,
    };
    const text = renderKnowledge({ ...base, hits: [hit] });
    assert.match(text, /\[1\] SOP-ETCH-012 · 湿法清洁 › 放行检查\n颗粒少于 10 颗。/);
    assert.match(text, /may not answer the question/);
    assert.doesNotMatch(
      renderKnowledge({ ...base, rerankModel: "m", hits: [{ ...hit, relevance: 3 }] }),
      /may not answer the question/,
    );
  });
});
