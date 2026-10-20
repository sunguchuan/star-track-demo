/**
 * Investigate-specific output checks. These belong with the fab agent, not the
 * generic Gateway guardrails (which keep secrets + configurable grounding only).
 */
import { ACTION_PLAN_SECTIONS } from "../action-plan";
import { checkGrounding } from "../guardrails/output";
import type { GuardrailHit } from "../types";

const MAX_LISTED = 10;
/** Shorter replies (refusals, "batch not found") are not expected to follow the plan format. */
const MIN_PLAN_CHARS = 200;

export function checkActionPlan(output: string, evidence: string): GuardrailHit[] {
  const hits: GuardrailHit[] = [];
  if (!output.trim()) return hits;

  const lower = output.toLowerCase();
  const missing = ACTION_PLAN_SECTIONS.filter(
    (s) => !output.includes(s.zh) && !lower.includes(s.en),
  );
  if (missing.length > 0 && output.trim().length >= MIN_PLAN_CHARS) {
    hits.push({
      stage: "output",
      rule: "missing_sections",
      action: "warn",
      message: "Action Plan 缺少规定章节",
      detail: missing.map((s) => s.zh).join("、"),
    });
  }

  const ungrounded = checkGrounding(output, evidence);
  if (ungrounded.length > 0) {
    hits.push({
      stage: "output",
      rule: "ungrounded_facts",
      action: "warn",
      message: "以下内容未在工具返回的数据中找到，请人工核实",
      detail:
        ungrounded.slice(0, MAX_LISTED).join(", ") +
        (ungrounded.length > MAX_LISTED ? ` 等 ${ungrounded.length} 项` : ""),
    });
  }

  return hits;
}
