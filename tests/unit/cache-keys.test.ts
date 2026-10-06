import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allowedTargets,
  buildCacheContext,
  cacheModeFor,
  decideHit,
  extractKeyTerms,
  parseChineseNumber,
  similarityThreshold,
  storeSkipReason,
  type CacheCandidate,
} from "@/lib/ai/cache-keys";

const sameTerms = (a: string, b: string) =>
  assert.deepEqual(extractKeyTerms(a), extractKeyTerms(b), `${a} | ${b}`);
const differentTerms = (a: string, b: string) =>
  assert.notDeepEqual(extractKeyTerms(a), extractKeyTerms(b), `${a} | ${b}`);

describe("cacheModeFor", () => {
  it("questions by meaning, rewrite tasks by identical input, chat with history never", () => {
    assert.equal(cacheModeFor("investigate", false), "semantic");
    assert.equal(cacheModeFor("investigate", true), "semantic");
    assert.equal(cacheModeFor("chat", false), "semantic");
    assert.equal(cacheModeFor("chat", true), null);
    for (const task of ["summarize", "polish", "translate", "tags", "refactor"] as const) {
      assert.equal(cacheModeFor(task, false), "exact");
    }
  });

  it("strategy limits which side's answers may be served", () => {
    assert.deepEqual(allowedTargets("only-local"), ["local"]);
    assert.deepEqual(allowedTargets("only-cloud"), ["cloud"]);
    assert.deepEqual(allowedTargets("auto"), ["local", "cloud"]);
  });
});

describe("parseChineseNumber", () => {
  it("parses 一..九十九", () => {
    assert.equal(parseChineseNumber("三"), 3);
    assert.equal(parseChineseNumber("两"), 2);
    assert.equal(parseChineseNumber("十"), 10);
    assert.equal(parseChineseNumber("十二"), 12);
    assert.equal(parseChineseNumber("二十"), 20);
    assert.equal(parseChineseNumber("二十五"), 25);
  });

  it("rejects anything else", () => {
    assert.equal(parseChineseNumber("一百"), null);
    assert.equal(parseChineseNumber("三四"), null);
    assert.equal(parseChineseNumber("abc"), null);
  });
});

describe("extractKeyTerms", () => {
  it("captures IDs, direction and question type", () => {
    assert.deepEqual(extractKeyTerms("Etch Chamber B7 良率为什么下降？"), ["?why", "B7", "~down"]);
  });

  it("normalizes case and number spelling so paraphrases match", () => {
    sameTerms("批次 b-240909-01 为什么低于控制限？", "B-240909-01 这个批次为啥跌破控制限了");
    sameTerms("最近三天有哪些严重告警？", "最近 3 天有哪些严重告警");
    sameTerms("Show the last five batches", "Show the last 5 batches");
    sameTerms("Why is chamber B7 yield dropping?", "What is causing the yield drop on chamber B7?");
  });

  it("separates different entities, numbers, directions and question types", () => {
    differentTerms("Etch Chamber B7 良率为什么下降？", "Etch Chamber B9 良率为什么下降？");
    differentTerms("NAND-V8 产品线良率", "DRAM-1z 产品线良率");
    differentTerms("A 班的良率怎么样？", "B 班的良率怎么样？");
    differentTerms("shift A yield", "shift B yield");
    differentTerms("最近三天有哪些严重告警？", "最近七天有哪些严重告警？");
    differentTerms("良率低于 90% 的批次", "良率低于 95% 的批次");
    differentTerms("B7 良率为什么下降？", "B7 良率为什么上升？");
    differentTerms("Why did B7 yield go down?", "Why did B7 yield go up?");
    differentTerms("当前未关闭的严重告警有哪些？", "当前未关闭的严重告警该怎么处理？");
    differentTerms("批次 B-240915-01 的良率是多少？", "批次 B-240915-01 为什么报废？");
  });

  it("a letter inside an ID is not a shift label", () => {
    assert.ok(!extractKeyTerms("B7 线上情况").includes("#B"));
  });
});

describe("buildCacheContext", () => {
  const base = {
    mode: "semantic" as const,
    taskType: "investigate" as const,
    history: [],
    strategy: "auto" as const,
    dataVersion: "abc",
  };

  it("partitions by mode, task, reply language and data version", () => {
    const zh = buildCacheContext({ ...base, input: "B7 良率为什么下降？" });
    const en = buildCacheContext({ ...base, input: "Why is B7 yield dropping?" });
    const newData = buildCacheContext({ ...base, input: "B7 良率为什么下降？", dataVersion: "def" });
    assert.notEqual(zh.partition, en.partition);
    assert.notEqual(zh.partition, newData.partition);
    assert.match(zh.partition, /\|semantic\|investigate\|/);
  });

  it("exact key covers task, trimmed input and history", () => {
    const a = buildCacheContext({ ...base, mode: "exact", taskType: "summarize", input: " text " });
    const b = buildCacheContext({ ...base, mode: "exact", taskType: "summarize", input: "text" });
    const c = buildCacheContext({ ...base, mode: "exact", taskType: "polish", input: "text" });
    const d = buildCacheContext({
      ...base,
      mode: "exact",
      taskType: "summarize",
      input: "text",
      history: [{ role: "user", content: "earlier" }],
    });
    assert.equal(a.exactKey, b.exactKey);
    assert.notEqual(b.exactKey, c.exactKey);
    assert.notEqual(b.exactKey, d.exactKey);
  });
});

describe("decideHit", () => {
  const context = { terms: "?why B7 ~down", allowed: ["local", "cloud"] as const };
  const candidate = (patch: Partial<CacheCandidate>): CacheCandidate => ({
    id: "x",
    target: "local",
    terms: context.terms,
    similarity: 0.9,
    ...patch,
  });

  it("serves the most similar candidate above the threshold with matching terms", () => {
    const decision = decideHit(
      [candidate({ id: "a", similarity: 0.85 }), candidate({ id: "b", similarity: 0.95 })],
      { ...context, allowed: [...context.allowed] },
      0.8,
    );
    assert.equal(decision.hit?.id, "b");
  });

  it("rejects term mismatches even when they are the most similar", () => {
    const decision = decideHit(
      [candidate({ id: "b9", terms: "?why B9 ~down", similarity: 0.97 }), candidate({ id: "b7", similarity: 0.82 })],
      { ...context, allowed: [...context.allowed] },
      0.8,
    );
    assert.equal(decision.hit?.id, "b7");
    assert.equal(decision.rejectedByTerms, 1);
    assert.equal(decision.best?.id, "b9");
    assert.equal(decision.best?.termsMatch, false);
  });

  it("misses below the threshold and skips targets the strategy excludes", () => {
    assert.equal(decideHit([candidate({ similarity: 0.79 })], { ...context, allowed: ["local"] }, 0.8).hit, null);
    assert.equal(
      decideHit([candidate({ target: "cloud", similarity: 0.99 })], { ...context, allowed: ["local"] }, 0.8).hit,
      null,
    );
  });
});

describe("similarityThreshold", () => {
  afterEach(() => {
    delete process.env.AI_CACHE_THRESHOLD;
  });

  it("per model, ignoring Ollama tags, with an env override", () => {
    assert.equal(similarityThreshold("embeddinggemma:latest"), similarityThreshold("embeddinggemma"));
    assert.notEqual(similarityThreshold("embeddinggemma"), similarityThreshold("gemini-embedding-001"));
    process.env.AI_CACHE_THRESHOLD = "0.97";
    assert.equal(similarityThreshold("gemini-embedding-001"), 0.97);
  });
});

describe("storeSkipReason", () => {
  const clean = {
    status: "ok",
    outputChars: 100,
    errorCode: null,
    sensitive: false,
    guardrailStages: [] as string[],
    ungroundedRefs: 0,
  };

  it("stores clean answers; input-stage notices are fine", () => {
    assert.equal(storeSkipReason(clean), null);
    assert.equal(storeSkipReason({ ...clean, guardrailStages: ["input"] }), null);
  });

  it("skips failed, fallen-back, sensitive, flagged or ungrounded answers", () => {
    assert.ok(storeSkipReason({ ...clean, status: "error" }));
    assert.ok(storeSkipReason({ ...clean, outputChars: 0 }));
    assert.ok(storeSkipReason({ ...clean, errorCode: "quota_exhausted" }));
    assert.ok(storeSkipReason({ ...clean, sensitive: true }));
    assert.ok(storeSkipReason({ ...clean, guardrailStages: ["output"] }));
    assert.ok(storeSkipReason({ ...clean, guardrailStages: ["tool"] }));
    assert.ok(storeSkipReason({ ...clean, ungroundedRefs: 1 }));
  });
});
