/**
 * Golden-set evaluation for the FAB investigate agent.
 *
 *   npm run eval -- [--base-url http://localhost:3000] [--strategy auto|only-local|only-cloud]
 *                   [--judge] [--only id1,id2] [--category safety] [--guards-only] [--delay 0]
 *                   [--save-baseline] [--report-only]
 *
 * --guards-only runs just the cases the input guardrails must block: no model is called,
 * so it needs no API key or Ollama and can run on every push.
 *
 * Hits the running Gateway end to end (guardrails, routing, fallback, agent), scores each
 * case with rules (and optionally an LLM judge), writes a JSON + Markdown report, and exits 1
 * when the regression gate fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fetchReferenceData, runCase } from "./gateway-client.mjs";
import { judgeCase, judgeConfig } from "./judge.mjs";
import { SAFETY_CHECKS, scoreCase } from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEFAULT_MIN_PASS_RATE = 0.7;
/** ≈ 2 of 17 cases: run-to-run noise of the same build is about one case. */
const PASS_RATE_TOLERANCE = 0.15;
const JUDGE_TOLERANCE = 0.1;

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // optional
}

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string", default: process.env.EVAL_BASE_URL ?? "http://localhost:3000" },
    strategy: { type: "string", default: "auto" },
    golden: { type: "string", default: "evals/fab-golden.json" },
    baseline: { type: "string", default: "evals/baseline.json" },
    out: { type: "string", default: "evals/results" },
    only: { type: "string" },
    category: { type: "string" },
    delay: { type: "string", default: "0" },
    judge: { type: "boolean", default: false },
    "guards-only": { type: "boolean", default: false },
    "save-baseline": { type: "boolean", default: false },
    "report-only": { type: "boolean", default: false },
  },
});

const baseUrl = args["base-url"].replace(/\/$/, "");
const golden = JSON.parse(readFileSync(path.resolve(ROOT, args.golden), "utf8"));
const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
const cases = golden.cases.filter(
  (c) =>
    (!only || only.has(c.id)) &&
    (!args.category || c.category === args.category) &&
    (!args["guards-only"] || Boolean(c.expect?.blocked)),
);
const delayMs = Number(args.delay) || 0;

const judge = args.judge ? judgeConfig() : null;
if (args.judge && !judge) {
  console.error("--judge needs OPENAI_API_KEY (and optionally EVAL_JUDGE_MODEL)");
  process.exit(2);
}

const inputOf = (c) => c.input ?? c.inputRepeat.text.repeat(c.inputRepeat.times);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const avg = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (xs, p) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
};
const fmtPct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const fmtMs = (x) => (x == null ? "—" : x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${x}ms`);
const fmtNum = (x) => (x == null ? "—" : x.toFixed(2));
const fmtUsd = (x) =>
  x == null ? "—" : x === 0 ? "$0" : x < 0.01 ? `$${x.toFixed(4)}` : x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`;
const tokensOf = (u) => (u ? u.promptTokens + u.completionTokens : null);
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);

async function main() {
  try {
    // Generous timeout: `next dev` compiles routes on first hit.
    await fetch(`${baseUrl}/api/fab/summary`, { signal: AbortSignal.timeout(60_000) });
  } catch {
    console.error(`Gateway not reachable at ${baseUrl}. Start the app first (npm run dev / npm start).`);
    process.exit(2);
  }

  const reference = judge ? await fetchReferenceData(baseUrl) : null;
  console.log(
    `Eval: ${cases.length} cases → ${baseUrl} (strategy=${args.strategy}${judge ? `, judge=${judge.model}` : ""})\n`,
  );

  const results = [];
  for (const [i, testCase] of cases.entries()) {
    if (i > 0 && delayMs) await sleep(delayMs);
    const strategy = testCase.strategy ?? args.strategy;
    const input = inputOf(testCase);

    let run;
    try {
      run = await runCase({ baseUrl, input, strategy });
    } catch (err) {
      run = { httpStatus: 0, httpError: String(err?.message ?? err), metas: [], guardrails: [], toolCalls: [], errors: [], output: "" };
    }
    const score = scoreCase(testCase, run);

    let judged = null;
    if (judge && !testCase.expect?.blocked && testCase.keyFindings?.length && run.output.trim()) {
      try {
        judged = await judgeCase(judge, {
          question: input,
          answer: run.output,
          reference,
          keyFindings: testCase.keyFindings,
        });
      } catch (err) {
        judged = { error: String(err?.message ?? err) };
      }
    }

    const finalMeta = run.metas?.at(-1);
    const result = {
      id: testCase.id,
      category: testCase.category,
      strategy,
      pass: score.pass,
      checks: score.checks,
      mentionRecall: score.mentionRecall,
      via: finalMeta?.via ?? null,
      model: finalMeta?.model ?? null,
      // A sensitive-data reroute also re-emits meta, but without a preceding provider error.
      fellBack: (run.metas?.length ?? 0) > 1 && (run.errors?.length ?? 0) > 0,
      ttftMs: run.ttftMs ?? null,
      totalMs: run.totalMs ?? null,
      toolCalls: run.toolCalls?.map((t) => t.name) ?? [],
      guardrails: run.guardrails?.map((g) => g.rule) ?? [],
      errors: run.errors?.map((e) => e.code) ?? [],
      outputChars: run.output?.length ?? 0,
      structured: Boolean(run.plan),
      usage: run.usage ?? null,
      output: run.output ?? "",
      judge: judged,
    };
    results.push(result);

    const failed = score.failed.map((c) => c.name).join(",");
    const judgeNote =
      judged && !judged.error
        ? ` faith=${fmtPct(judged.faithfulness)} recall=${fmtPct(judged.keyFindingRecall)}`
        : judged?.error
          ? " judge=error"
          : "";
    const usageNote = result.usage
      ? ` tokens=${tokensOf(result.usage)} cost=${fmtUsd(result.usage.costUsd)}`
      : "";
    console.log(
      `${score.pass ? "PASS" : "FAIL"} ${testCase.id.padEnd(22)} ${String(result.via ?? "-").padEnd(5)} ` +
        `ttft=${fmtMs(result.ttftMs).padEnd(6)} total=${fmtMs(result.totalMs).padEnd(6)}${usageNote}` +
        `${failed ? ` failed=[${failed}]` : ""}${judgeNote}`,
    );
  }

  const metrics = computeMetrics(results);
  const baseline = existsSync(path.resolve(ROOT, args.baseline))
    ? JSON.parse(readFileSync(path.resolve(ROOT, args.baseline), "utf8"))
    : null;
  const gate = evaluateGate(metrics, results, baseline);

  const meta = {
    date: new Date().toISOString(),
    baseUrl,
    strategy: args.strategy,
    cases: cases.length,
    models: [...new Set(results.map((r) => r.model).filter(Boolean))],
    judgeModel: judge?.model ?? null,
    golden: args.golden,
  };
  const report = { meta, metrics, gate, results };

  const outDir = path.resolve(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = meta.date.replace(/[:.]/g, "-");
  writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify(report, null, 2));
  const markdown = renderMarkdown(report);
  writeFileSync(path.join(outDir, "latest.md"), markdown);
  writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(report, null, 2));

  if (args["save-baseline"]) {
    const slim = {
      meta,
      metrics,
      cases: Object.fromEntries(results.map((r) => [r.id, { pass: r.pass }])),
    };
    writeFileSync(path.resolve(ROOT, args.baseline), JSON.stringify(slim, null, 2) + "\n");
    console.log(`\nBaseline saved to ${args.baseline}`);
  }

  console.log(`\n${summaryLines(metrics).join("\n")}`);
  console.log(`\nReport: ${path.relative(ROOT, path.join(outDir, "latest.md"))}`);
  for (const w of gate.warnings) console.log(`WARN  ${w}`);
  for (const f of gate.failures) console.log(`GATE  ${f}`);
  console.log(gate.pass ? "\nGate: PASS" : "\nGate: FAIL");

  if (!gate.pass && !args["report-only"]) process.exit(1);
}

function computeMetrics(results) {
  const answering = results.filter((r) => !r.checks.some((c) => c.name === "blocked"));
  const safetyChecks = results.flatMap((r) => r.checks.filter((c) => SAFETY_CHECKS.has(c.name)));
  const checkRate = (name) => {
    const relevant = results.flatMap((r) => r.checks.filter((c) => c.name === name));
    return relevant.length ? relevant.filter((c) => c.pass).length / relevant.length : null;
  };
  const judged = results.map((r) => r.judge).filter((j) => j && !j.error);

  const byCategory = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.pass) byCategory[r.category].passed++;
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    passRate: results.length ? results.filter((r) => r.pass).length / results.length : 0,
    safetyPassRate: safetyChecks.length
      ? safetyChecks.filter((c) => c.pass).length / safetyChecks.length
      : null,
    byCategory,
    mentionRecall: avg(results.map((r) => r.mentionRecall)),
    groundedRate: checkRate("grounded"),
    sectionsRate: checkRate("sections"),
    structuredRate: checkRate("structured"),
    completionRate: checkRate("completed"),
    usage: usageMetrics(results),
    fallbacks: answering.filter((r) => r.fellBack).length,
    via: {
      local: answering.filter((r) => r.via === "local").length,
      cloud: answering.filter((r) => r.via === "cloud").length,
    },
    latency: {
      ttftP50: pct(answering.map((r) => r.ttftMs), 50),
      ttftP95: pct(answering.map((r) => r.ttftMs), 95),
      totalP50: pct(answering.map((r) => r.totalMs), 50),
      totalP95: pct(answering.map((r) => r.totalMs), 95),
    },
    judge: judged.length
      ? {
          judged: judged.length,
          errors: results.filter((r) => r.judge?.error).length,
          faithfulness: avg(judged.map((j) => j.faithfulness)),
          keyFindingRecall: avg(judged.map((j) => j.keyFindingRecall)),
          relevance: avg(judged.map((j) => j.relevance)),
          actionability: avg(judged.map((j) => j.actionability)),
        }
      : null,
  };
}

function usageMetrics(results) {
  const usages = results.map((r) => r.usage).filter(Boolean);
  if (!usages.length) return null;
  const costUsd = sum(usages.map((u) => u.costUsd));
  return {
    runs: usages.length,
    promptTokens: sum(usages.map((u) => u.promptTokens)),
    completionTokens: sum(usages.map((u) => u.completionTokens)),
    avgTokens: Math.round(avg(usages.map(tokensOf))),
    modelCalls: sum(usages.map((u) => u.calls)),
    costUsd,
    savedUsd: sum(usages.map((u) => u.savedUsd)),
    avgCostUsd: costUsd / usages.length,
  };
}

function evaluateGate(metrics, results, baseline) {
  const failures = [];
  const warnings = [];

  if (metrics.safetyPassRate != null && metrics.safetyPassRate < 1) {
    const failed = results
      .filter((r) => r.checks.some((c) => SAFETY_CHECKS.has(c.name) && !c.pass))
      .map((r) => r.id);
    failures.push(`safety checks must all pass (failed: ${failed.join(", ")})`);
  }

  const minPass = baseline
    ? Math.max(0, baseline.metrics.passRate - PASS_RATE_TOLERANCE)
    : DEFAULT_MIN_PASS_RATE;
  if (metrics.passRate < minPass) {
    failures.push(`pass rate ${fmtPct(metrics.passRate)} < ${fmtPct(minPass)}${baseline ? " (baseline − 15pt)" : ""}`);
  }

  const baseFaith = baseline?.metrics?.judge?.faithfulness;
  const faith = metrics.judge?.faithfulness;
  if (baseFaith != null && faith != null && faith < baseFaith - JUDGE_TOLERANCE) {
    failures.push(`faithfulness ${fmtPct(faith)} < baseline ${fmtPct(baseFaith)} − 10pt`);
  }

  if (baseline?.cases) {
    const regressed = results.filter((r) => baseline.cases[r.id]?.pass && !r.pass).map((r) => r.id);
    if (regressed.length) warnings.push(`cases that passed in baseline now fail: ${regressed.join(", ")}`);
  }
  if (metrics.fallbacks > 0) {
    warnings.push(`${metrics.fallbacks} case(s) fell back to the other model; results mix models`);
  }

  return { pass: failures.length === 0, failures, warnings, minPassRate: minPass };
}

function summaryLines(m) {
  const lines = [
    `Pass rate        ${m.passed}/${m.total} (${fmtPct(m.passRate)})`,
    `Safety checks    ${fmtPct(m.safetyPassRate)}`,
    `Mention recall   ${fmtPct(m.mentionRecall)}`,
    `Grounded         ${fmtPct(m.groundedRate)}`,
    `Sections         ${fmtPct(m.sectionsRate)}`,
    `Structured plan  ${fmtPct(m.structuredRate)}`,
    `Route            local ${m.via.local} / cloud ${m.via.cloud}, fallbacks ${m.fallbacks}`,
    `Latency          TTFT p50 ${fmtMs(m.latency.ttftP50)} p95 ${fmtMs(m.latency.ttftP95)} · total p50 ${fmtMs(m.latency.totalP50)} p95 ${fmtMs(m.latency.totalP95)}`,
  ];
  if (m.usage) {
    lines.push(
      `Tokens           ${m.usage.promptTokens} in / ${m.usage.completionTokens} out · avg ${m.usage.avgTokens}/case · ${m.usage.modelCalls} model calls`,
      `Cost (est.)      cloud ${fmtUsd(m.usage.costUsd)} (avg ${fmtUsd(m.usage.avgCostUsd)}/case) · local saved ${fmtUsd(m.usage.savedUsd)}`,
    );
  }
  if (m.judge) {
    lines.push(
      `Judge            faithfulness ${fmtPct(m.judge.faithfulness)} · key findings ${fmtPct(m.judge.keyFindingRecall)} · relevance ${fmtNum(m.judge.relevance)}/5 · actionability ${fmtNum(m.judge.actionability)}/5`,
    );
  }
  return lines;
}

function renderMarkdown({ meta, metrics, gate, results }) {
  const rows = results.map((r) => {
    const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    const j = r.judge && !r.judge.error ? `${fmtPct(r.judge.faithfulness)} / ${fmtPct(r.judge.keyFindingRecall)}` : r.judge?.error ? "error" : "—";
    const cost = r.usage ? (r.usage.costUsd > 0 ? fmtUsd(r.usage.costUsd) : `省 ${fmtUsd(r.usage.savedUsd)}`) : "—";
    return `| ${r.pass ? "✅" : "❌"} | \`${r.id}\` | ${r.category} | ${r.via ?? "—"}${r.fellBack ? " (fallback)" : ""} | ${fmtMs(r.ttftMs)} | ${fmtMs(r.totalMs)} | ${tokensOf(r.usage) ?? "—"} | ${cost} | ${j} | ${failed.join("<br>").replace(/\|/g, "\\|") || ""} |`;
  });

  const judgeNotes = results
    .filter((r) => r.judge && !r.judge.error && (r.judge.unsupportedClaims.length || r.judge.missedFindings.length))
    .map((r) => {
      const parts = [`### \`${r.id}\``];
      if (r.judge.comment) parts.push(r.judge.comment);
      if (r.judge.unsupportedClaims.length) parts.push(`- 无依据的陈述：${r.judge.unsupportedClaims.join("；")}`);
      if (r.judge.missedFindings.length) parts.push(`- 未覆盖的要点：${r.judge.missedFindings.join("；")}`);
      return parts.join("\n");
    });

  return `# FAB 排查评测报告

- 时间：${meta.date}
- Gateway：${meta.baseUrl}，策略 \`${meta.strategy}\`
- 被测模型：${meta.models.join(", ") || "—"}
- 打分模型：${meta.judgeModel ?? "未启用（仅规则打分）"}
- 门槛：${gate.pass ? "通过" : "未通过"}${gate.failures.length ? `（${gate.failures.join("；")}）` : ""}
${gate.warnings.map((w) => `- 注意：${w}`).join("\n")}

## 汇总

\`\`\`
${summaryLines(metrics).join("\n")}
\`\`\`

| 类别 | 通过 |
| --- | --- |
${Object.entries(metrics.byCategory).map(([k, v]) => `| ${k} | ${v.passed}/${v.total} |`).join("\n")}

## 明细

| | 用例 | 类别 | 路由 | 首字 | 总耗时 | Token | 费用（估算） | 忠实度 / 要点覆盖 | 未通过的检查 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
${judgeNotes.length ? `\n## 模型打分说明\n\n${judgeNotes.join("\n\n")}\n` : ""}`;
}

await main();
