/**
 * Retrieval ablation: npm run eval:rag [-- --embed local|cloud] [--no-rerank] [--only <id>] [--save]
 *
 * Runs every query in evals/rag-queries.json through the hybrid pipeline once and scores each
 * stage's ranking against the labelled sections:
 *   BM25 → Vector → Hybrid (RRF) → final list (after the rerank relevance cut, or after the
 *   similarity floor when not reranked)
 * Positive queries report Hit@1 / Recall@3 / Recall@5 / MRR / nDCG@5, plus Recall@8 for the
 * first stages (the candidates the reranker sees); negative queries (no answer in the
 * knowledge base) report whether the stage correctly returned nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCloudModel, isCloudConfigured } from "@/lib/ai/router";
import { RunTrace } from "@/lib/ai/trace";
import { loadCorpus } from "@/lib/rag/corpus";
import { meanScores, scoreRanking, type QueryScores } from "@/lib/rag/metrics";
import { retrieve, type KbFilter, type RetrievalResult } from "@/lib/rag/retrieve";

type GoldQuery = { id: string; category: string; query: string; filter?: KbFilter; relevant: string[] };
type Stage = "bm25" | "vector" | "hybrid" | "final";
const EVAL_TOP_K = 5;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const embedSide = option("--embed") ?? "auto";
const embed = {
  localRuntime: embedSide !== "cloud",
  cloudAvailable: embedSide !== "local" && isCloudConfigured(),
};
const rerankModel = !flag("--no-rerank") && isCloudConfigured() ? getCloudModel() : null;
const stages: Stage[] = ["bm25", "vector", "hybrid", "final"];
const STAGE_LABELS: Record<Stage, string> = {
  bm25: "BM25",
  vector: "Vector",
  hybrid: "Hybrid (RRF)",
  // Without the reranker, the final list is the fused list after the similarity floor.
  final: rerankModel ? "Hybrid + rerank" : "Hybrid + floor",
};

function rankings(result: RetrievalResult): Record<Stage, string[]> {
  const ids = (list: { sectionId: string }[]) => list.map((s) => s.sectionId);
  return {
    bm25: ids(result.stages.bm25),
    vector: ids(result.stages.vector),
    hybrid: ids(result.stages.fused),
    final: result.hits.map((h) => h.sectionId),
  };
}

async function retrieveWithRetry(q: GoldQuery, trace: RunTrace): Promise<RetrievalResult> {
  for (let attempt = 1; ; attempt++) {
    const result = await retrieve({
      query: q.query,
      filter: q.filter,
      mode: "hybrid",
      topK: EVAL_TOP_K,
      embed,
      rerankModel,
      span: trace.start(`query.${q.id}`, "span"),
    });
    const transient = result.vectorError || result.rerankError;
    if (!transient || attempt >= 3) return result;
    process.stdout.write(`  retry ${q.id}: ${transient}\n`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(9);
const num = (n: number) => n.toFixed(3).padStart(9);

async function main() {
  const gold = (JSON.parse(readFileSync("evals/rag-queries.json", "utf8")) as { queries: GoldQuery[] }).queries;
  const only = option("--only");
  const queries = only ? gold.filter((q) => q.id === only) : gold;
  const corpus = loadCorpus();

  const unknown = queries.flatMap((q) => q.relevant.filter((id) => !corpus.sections.has(id)).map((id) => `${q.id}: ${id}`));
  if (unknown.length > 0) {
    console.error(`Labels point at sections that do not exist:\n  ${unknown.join("\n  ")}`);
    process.exit(1);
  }

  console.log(
    `Knowledge base: ${corpus.docs.length} docs, ${corpus.sections.size} sections, ${corpus.chunks.length} chunks (v${corpus.version})`,
  );
  console.log(`Embedding: ${embedSide} · rerank: ${rerankModel ?? "off"} · ${queries.length} queries\n`);

  const trace = new RunTrace(crypto.randomUUID());
  const rows: {
    q: GoldQuery;
    result: RetrievalResult;
    ranked: Record<Stage, string[]>;
    scores: Partial<Record<Stage, QueryScores>>;
  }[] = [];
  for (const q of queries) {
    const result = await retrieveWithRetry(q, trace);
    const ranked = rankings(result);
    const scores: Partial<Record<Stage, QueryScores>> = {};
    if (q.relevant.length > 0) for (const s of stages) scores[s] = scoreRanking(ranked[s], q.relevant);
    rows.push({ q, result, ranked, scores });
    const top = ranked.final.slice(0, 3);
    const mark = q.relevant.length === 0 ? (top.length === 0 ? "∅" : "!") : top.some((id) => q.relevant.includes(id)) ? "✓" : "✗";
    process.stdout.write(`${mark} ${q.id.padEnd(22)} ${result.ms}ms  ${top.join(" | ") || "(nothing)"}\n`);
    if (flag("--verbose")) {
      for (const s of stages) {
        const list = ranked[s].slice(0, 5).map((id) => (q.relevant.includes(id) ? `*${id}` : id));
        process.stdout.write(`    ${STAGE_LABELS[s].padEnd(16)} ${list.join(" | ") || "(nothing)"}\n`);
      }
    }
  }

  const embedModel = rows.find((r) => r.result.embedModel)?.result.embedModel ?? null;
  const vectorErrors = rows.filter((r) => r.result.vectorError).length;
  const rerankErrors = rows.filter((r) => r.result.rerankError).length;
  const positives = rows.filter((r) => r.q.relevant.length > 0);
  const negatives = rows.filter((r) => r.q.relevant.length === 0);

  console.log(`\nEmbedding model: ${embedModel ?? "none (BM25 only)"}${vectorErrors ? ` · vector errors: ${vectorErrors}` : ""}${rerankErrors ? ` · rerank errors: ${rerankErrors}` : ""}`);
  console.log(`\n${"Stage".padEnd(18)}${"Hit@1".padStart(9)}${"Recall@3".padStart(9)}${"Recall@5".padStart(9)}${"Recall@8".padStart(9)}${"MRR".padStart(9)}${"nDCG@5".padStart(9)}${"Abstain".padStart(9)}`);
  const summary: Record<string, QueryScores & { abstain: number }> = {};
  for (const s of stages) {
    const mean = meanScores(positives.map((r) => r.scores[s]!));
    const abstain = negatives.length
      ? negatives.filter((r) => r.ranked[s].length === 0).length / negatives.length
      : 0;
    summary[s] = { ...mean, abstain };
    console.log(
      `${STAGE_LABELS[s].padEnd(18)}${pct(mean.hit1)}${pct(mean.recall3)}${pct(mean.recall5)}${s === "final" ? "      n/a" : pct(mean.recall8)}${num(mean.mrr)}${num(mean.ndcg5)}${negatives.length ? pct(abstain) : "      n/a"}`,
    );
  }

  const categories = [...new Set(positives.map((r) => r.q.category))];
  console.log(`\nRecall@3 by category\n${"Stage".padEnd(18)}${categories.map((c) => c.padStart(13)).join("")}`);
  const byCategory: Record<string, Record<string, number>> = {};
  for (const s of stages) {
    byCategory[s] = {};
    const cells = categories.map((c) => {
      const inCat = positives.filter((r) => r.q.category === c);
      const value = meanScores(inCat.map((r) => r.scores[s]!)).recall3;
      byCategory[s][c] = value;
      return `${pct(value).trim()} (${inCat.length})`.padStart(13);
    });
    console.log(`${STAGE_LABELS[s].padEnd(18)}${cells.join("")}`);
  }

  const last = stages.at(-1)!;
  const misses = positives.filter((r) => (r.scores[last]?.recall3 ?? 0) < 1);
  if (misses.length > 0) {
    console.log(`\n${STAGE_LABELS[last]}: queries with Recall@3 < 100%`);
    for (const r of misses) {
      const found = r.ranked[last].slice(0, 3);
      console.log(`  ${r.q.id}: missing ${r.q.relevant.filter((id) => !found.includes(id)).join(", ")} · got ${found.join(" | ") || "(nothing)"}`);
    }
  }

  const costUsd = trace.spans.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const avgMs = rows.reduce((sum, r) => sum + r.result.ms, 0) / (rows.length || 1);
  console.log(`\nAvg latency ${avgMs.toFixed(0)} ms per query · cost $${costUsd.toFixed(5)} (embeddings + rerank, including any index build)`);

  if (flag("--save")) {
    const dir = join("evals", "results");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `rag-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          config: {
            embed: embedSide,
            embedModel,
            rerankModel,
            similarityFloor: rows.find((r) => r.result.similarityFloor != null)?.result.similarityFloor ?? null,
            corpusVersion: corpus.version,
            topK: EVAL_TOP_K,
          },
          summary,
          byCategory,
          avgMs,
          costUsd,
          queries: rows.map((r) => ({
            id: r.q.id,
            category: r.q.category,
            relevant: r.q.relevant,
            ranked: r.ranked,
            scores: r.scores,
            rerank: r.result.stages.rerank,
            ms: r.result.ms,
            vectorError: r.result.vectorError,
            rerankError: r.result.rerankError,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`Saved ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
