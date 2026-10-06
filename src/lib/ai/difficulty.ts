/**
 * Rule-based difficulty score used to pick the cloud model tier: simple requests stay on
 * the cheap CLOUD_MODEL, complex ones (multi-entity comparisons, causal links, long briefs)
 * go to CLOUD_MODEL_STRONG. Pure and deterministic so it can be unit-tested and replayed
 * from the run record; a model-based classifier would cost a call on every request.
 */
import { extractKeyTerms } from "./cache-keys";
import type { AiTaskType, ChatMessage } from "./types";

export type DifficultyLevel = "simple" | "complex";
/** Cloud model tier that produced the answer: CLOUD_MODEL or CLOUD_MODEL_STRONG. */
export type ModelTier = "standard" | "strong";

export type DifficultyAssessment = {
  level: DifficultyLevel;
  score: number;
  /** Signal names that contributed to the score, e.g. ["multi_entity", "comparison"]. */
  signals: string[];
};

export const COMPLEX_THRESHOLD = 3;

/** Mechanical rewrites never need the strong tier, whatever their length. */
const REWRITE_TASKS: readonly AiTaskType[] = ["summarize", "polish", "continue", "translate", "tags"];
const DEEP_TASKS: readonly AiTaskType[] = ["analyze", "refactor"];

const COMPARISON =
  /对比|比较|相比|差异|区别|两条|两个|两台|两批|\b(?:vs\.?|versus|compar\w*|differen\w*|both)\b/i;
const CAUSAL = /关联|有关|相关|影响|根因|\b(?:correlat\w*|related|root[\s-]cause|impact\w*)\b/i;
const WHY = /为什么|为啥|为何|原因|\bwhy\b/i;
const PLANNING = /行动计划|处理建议|优先级|\b(?:action\s+plan|prioriti\w*)\b/i;

const LONG_INPUT = 200;
const VERY_LONG_INPUT = 600;
const LONG_HISTORY = 2000;

/** Equipment / batch / product IDs and shift labels, not bare numbers or direction / question tags. */
function entityCount(text: string): number {
  return extractKeyTerms(text).filter((term) => !/^[~?]/.test(term) && !/^\d+$/.test(term)).length;
}

export function assessDifficulty(options: {
  taskType: AiTaskType;
  input: string;
  history?: ChatMessage[];
}): DifficultyAssessment {
  const { taskType, input, history = [] } = options;
  if (REWRITE_TASKS.includes(taskType)) return { level: "simple", score: 0, signals: [] };

  const signals: [name: string, weight: number][] = [];
  if (DEEP_TASKS.includes(taskType)) signals.push(["deep_task", 1]);
  if (entityCount(input) >= 2) signals.push(["multi_entity", 2]);
  if (COMPARISON.test(input)) signals.push(["comparison", 2]);
  if (CAUSAL.test(input)) signals.push(["causal", 1]);
  if (WHY.test(input)) signals.push(["why", 1]);
  if (PLANNING.test(input)) signals.push(["planning", 1]);
  if (input.length > VERY_LONG_INPUT) signals.push(["very_long_input", 2]);
  else if (input.length > LONG_INPUT) signals.push(["long_input", 1]);
  if ((input.match(/[?？]/g) ?? []).length >= 2) signals.push(["multi_question", 1]);
  const historyChars = history.reduce((sum, message) => sum + message.content.length, 0);
  if (historyChars > LONG_HISTORY) signals.push(["long_history", 1]);

  const score = signals.reduce((sum, [, weight]) => sum + weight, 0);
  return {
    level: score >= COMPLEX_THRESHOLD ? "complex" : "simple",
    score,
    signals: signals.map(([name]) => name),
  };
}
