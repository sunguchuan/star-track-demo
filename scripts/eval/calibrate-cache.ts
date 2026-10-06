/**
 * Semantic cache threshold calibration: npm run eval:cache [-- --local | --cloud]
 *
 * Embeds every pair in evals/cache-pairs.json with each available embedding model
 * (Ollama embeddinggemma locally, gemini-embedding-001 in the cloud), then reports
 * - per pair: similarity, whether the key terms match, and the decision at the current threshold;
 * - a threshold sweep: the lowest threshold with zero false hits (wrong answer served)
 *   and how many true paraphrases it still catches, with and without the key-term guard.
 *
 * Exits 1 when the configured threshold serves any must-not-hit pair.
 */
import { readFileSync } from "fs";
import { extractKeyTerms, similarityThreshold } from "@/lib/ai/cache-keys";
import { cosine, embedText, type Embedding } from "@/lib/ai/embeddings";

type Pair = { kind: string; expect: "hit" | "miss"; a: string; b: string; task?: string };
type Scored = Pair & { similarity: number; termsMatch: boolean };

const SAFETY_MARGIN = 0.02;
const { pairs } = JSON.parse(readFileSync("evals/cache-pairs.json", "utf8")) as { pairs: Pair[] };
const args = new Set(process.argv.slice(2));
const sides = [
  { target: "local", localRuntime: true, cloudAvailable: false },
  { target: "cloud", localRuntime: false, cloudAvailable: true },
].filter((s) => !(args.has("--local") && s.target === "cloud") && !(args.has("--cloud") && s.target === "local"));

const terms = (text: string) => extractKeyTerms(text).join(" ");
const fmt = (n: number) => n.toFixed(3);

function sweep(rows: Scored[], guard: boolean) {
  const shouldHit = rows.filter((r) => r.expect === "hit").length;
  const result: { threshold: number; truePos: number; falsePos: number; recall: number }[] = [];
  for (let t = 0.5; t <= 0.995; t += 0.01) {
    const threshold = Number(t.toFixed(2));
    const served = rows.filter((r) => r.similarity >= threshold && (!guard || r.termsMatch));
    const truePos = served.filter((r) => r.expect === "hit").length;
    result.push({
      threshold,
      truePos,
      falsePos: served.length - truePos,
      recall: shouldHit === 0 ? 0 : truePos / shouldHit,
    });
  }
  return result;
}

let failed = false;

for (const side of sides) {
  const vectors = new Map<string, Embedding>();
  let model = "";
  try {
    // A cold Ollama model takes ~30 s to load, longer than the Gateway's per-call timeout.
    for (let attempt = 1; ; attempt++) {
      try {
        await embedText({ text: "warm up", ...side });
        break;
      } catch (err) {
        if (attempt >= 6) throw err;
      }
    }
    for (const text of new Set(pairs.flatMap((p) => [p.a, p.b]))) {
      const embedding = await embedText({ text, ...side });
      vectors.set(text, embedding);
      model = embedding.model;
    }
  } catch (err) {
    console.log(`\n[${side.target}] skipped: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const rows: Scored[] = pairs.map((p) => ({
    ...p,
    similarity: cosine(vectors.get(p.a)!.vector, vectors.get(p.b)!.vector),
    termsMatch: terms(p.a) === terms(p.b),
  }));
  const current = similarityThreshold(model);

  console.log(`\n=== ${side.target}: ${model} (current threshold ${current}) ===`);
  console.log("ok  expect kind        sim    terms  pair");
  for (const r of [...rows].sort((x, y) => y.similarity - x.similarity)) {
    const served = r.similarity >= current && r.termsMatch;
    const ok = served === (r.expect === "hit");
    console.log(
      `${ok ? "✓" : "✗"}   ${r.expect.padEnd(6)} ${r.kind.padEnd(11)} ${fmt(r.similarity)}  ${r.termsMatch ? "same " : "DIFF "}  ${r.a} | ${r.b}`,
    );
  }

  const guarded = sweep(rows, true);
  const raw = sweep(rows, false);
  const floor = guarded.find((s) => s.falsePos === 0);
  const rawFloor = raw.find((s) => s.falsePos === 0);
  const at = (list: typeof guarded, t: number) =>
    list.find((s) => s.threshold === Number(t.toFixed(2))) ?? list[list.length - 1];
  const now = at(guarded, current);
  const nowRaw = at(raw, current);

  console.log(`\nAt current threshold ${current}:`);
  console.log(`  with key-term guard   : ${now.truePos} paraphrases served, ${now.falsePos} wrong answers served`);
  console.log(`  embedding only        : ${nowRaw.truePos} paraphrases served, ${nowRaw.falsePos} wrong answers served`);
  if (floor) {
    const recommended = Math.min(0.99, Number((floor.threshold + SAFETY_MARGIN).toFixed(2)));
    const rec = at(guarded, recommended);
    console.log(`Lowest zero-false-hit threshold (guarded): ${floor.threshold} (recall ${(floor.recall * 100).toFixed(0)}%)`);
    console.log(`Recommended (+${SAFETY_MARGIN} margin): ${recommended} (recall ${(rec.recall * 100).toFixed(0)}%)`);
  } else {
    console.log("No threshold reaches zero false hits with the guard — add key-term rules.");
  }
  console.log(
    `Embedding only would need ${rawFloor ? `${rawFloor.threshold} (recall ${(rawFloor.recall * 100).toFixed(0)}%)` : "a threshold above 0.99"} for zero false hits.`,
  );
  if (now.falsePos > 0) failed = true;
}

process.exit(failed ? 1 : 0);
