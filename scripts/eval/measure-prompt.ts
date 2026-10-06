/**
 * Prompt compression measurement: npm run eval:prompt
 *
 * For each investigate question in evals/fab-golden.json, builds the Action Plan call exactly
 * as the agent does (same tool data, same order) with compression off and on, sends both to
 * the cloud model and reports the provider-counted prompt_tokens. Tool selection is fixed so
 * the only difference between the two prompts is the compression.
 */
import { readFileSync } from "fs";
import { actionPlanJsonSchema } from "@/lib/ai/action-plan";
import { investigateSystem, planMessages, toolResultContent } from "@/lib/ai/agent";
import { completeCloudChat } from "@/lib/ai/cloud";
import { detectReplyLanguage } from "@/lib/ai/language";
import { getCloudModel, isCloudConfigured } from "@/lib/ai/router";
import { executeFabTool } from "@/lib/ai/tools/fab";
import type { ChatCompletionMessage } from "@/lib/ai/tools/types";

type GoldenCase = { id: string; category: string; input: string };

const TOOLS: [name: string, args: string][] = [
  ["get_fab_summary", "{}"],
  ["get_fab_batch", JSON.stringify({ batchId: "B-240909-01" })],
  ["list_fab_alerts", JSON.stringify({ limit: 10, openOnly: true })],
  ["list_fab_batches", JSON.stringify({ limit: 8 })],
];

function buildPlanCall(input: string, compress: boolean) {
  const language = detectReplyLanguage(input);
  const seen = new Set<string>();
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: investigateSystem(language) },
    { role: "user", content: input },
    {
      role: "assistant",
      content: null,
      tool_calls: TOOLS.map(([name, args], i) => ({
        id: `call_${i}`,
        type: "function" as const,
        function: { name, arguments: args },
      })),
    },
  ];
  TOOLS.forEach(([name, args], i) => {
    const result = executeFabTool(name, args);
    messages.push({
      role: "tool",
      tool_call_id: `call_${i}`,
      name,
      content: result.ok ? toolResultContent(result.data, compress, seen) : JSON.stringify({ error: result.error }),
    });
  });
  return planMessages(messages, { language, phase: "plan", target: "cloud", compress });
}

async function promptTokens(messages: ReturnType<typeof buildPlanCall>): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    let tokens = 0;
    try {
      await completeCloudChat({
        model: getCloudModel(),
        messages,
        jsonSchema: { name: "action_plan", schema: actionPlanJsonSchema() },
        signal: AbortSignal.timeout(60_000),
        onUsage: (usage) => {
          tokens = usage.promptTokens;
        },
      });
      return tokens;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`  retry ${attempt}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  if (!isCloudConfigured()) {
    console.error("OPENAI_API_KEY is not set; run with --env-file=.env.local");
    process.exit(1);
  }
  const { cases } = JSON.parse(readFileSync("evals/fab-golden.json", "utf8")) as { cases: GoldenCase[] };
  const questions = cases.filter((c) => c.category === "investigate" && c.input).slice(0, 6);

  console.log(`model ${getCloudModel()} · tools ${TOOLS.map(([n]) => n).join(", ")}\n`);
  console.log("case                     chars off→on        prompt_tokens off→on");
  let offTotal = 0;
  let onTotal = 0;
  for (const c of questions) {
    const off = buildPlanCall(c.input, false);
    const on = buildPlanCall(c.input, true);
    const chars = (m: typeof off) => m.reduce((n, x) => n + x.content.length, 0);
    const [offTokens, onTokens] = [await promptTokens(off), await promptTokens(on)];
    offTotal += offTokens;
    onTotal += onTokens;
    console.log(
      `${c.id.padEnd(24)} ${String(chars(off)).padStart(5)} → ${String(chars(on)).padEnd(8)} ` +
        `${String(offTokens).padStart(6)} → ${onTokens} (−${Math.round((1 - onTokens / offTokens) * 100)}%)`,
    );
  }
  console.log(
    `\nTOTAL prompt_tokens ${offTotal} → ${onTotal} (−${Math.round((1 - onTotal / offTotal) * 100)}%)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
